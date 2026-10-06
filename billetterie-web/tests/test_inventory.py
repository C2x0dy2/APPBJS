"""Critical invariants exercised on the actual generated SQLite migrations."""
import concurrent.futures
import pathlib
import sqlite3
import tempfile
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.connections = []
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT)
        self.path = pathlib.Path(self.tmp.name) / "test.sqlite"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            for migration in sorted((ROOT / "drizzle").glob("*.sql")):
                db.executescript(migration.read_text(encoding="utf-8"))
            db.execute("INSERT INTO collectives(id,name,color,created_at) VALUES('c','Test','#132a3b',0)")
            db.execute("INSERT INTO events(id,collective_id,name,location,starts_at,doors_at,cancel_until,status,created_at) VALUES('e','c','Concert','Salle',2000000000000,1999999000000,1999900000000,'on_sale',0)")
            db.execute("INSERT INTO ticket_types(id,event_id,name,price,capacity) VALUES('t','e','Fosse',2200,100)")
    def tearDown(self):
        for connection in self.connections:
            connection.close()
        self.tmp.cleanup()
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        self.connections.append(db)
        db.execute("PRAGMA foreign_keys=ON")
        return db
    def hold(self, db, id, qty=1):
        db.execute("INSERT INTO orders(id,event_id,email,name,token,total,expires_at,created_at) VALUES(?,'e','test@example.invalid','Test',?,?,2000000000000,0)", (id,id,2200*qty))
        db.execute("INSERT INTO order_items(id,order_id,type_id,quantity,unit_price) VALUES(?,?,'t',?,2200)",(id,id,qty))
    def pay(self, db, id, payment=None, qty=1):
        payment=payment or "payment-"+id
        db.execute("INSERT INTO payments(id,order_id,amount,status,created_at) VALUES(?,?,?,'paid',0)",(payment,id,2200*qty))
        db.execute("UPDATE orders SET status='paid',payment_id=?,paid_at=1 WHERE id=? AND status IN ('pending','expired')",(payment,id))
        for n in range(qty):
            db.execute("INSERT INTO tickets(id,order_id,type_id,code) VALUES(?,?,'t',?)",(id+"-"+str(n),id,id+"-qr-"+str(n)))
    def test_500_concurrent_purchases_exactly_100_tickets(self):
        gate=threading.Event()
        def purchase(n):
            gate.wait()
            db=self.connect()
            try:
                with db:
                    db.execute("BEGIN IMMEDIATE")
                    self.hold(db,str(n))
                    self.pay(db,str(n))
                return True
            except sqlite3.IntegrityError as error:
                self.assertIn("STOCK_UNAVAILABLE",str(error))
                return False
            finally:
                db.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
            tasks=[pool.submit(purchase,n) for n in range(500)]
            gate.set()
            accepted=sum(task.result() for task in tasks)
        with self.connect() as db:
            self.assertEqual(accepted,100)
            self.assertEqual(db.execute("SELECT count(*) FROM tickets").fetchone()[0],100)
            self.assertEqual(db.execute("SELECT sold,held FROM ticket_types").fetchone(),(100,0))
            self.assertEqual(db.execute("SELECT count(*) FROM orders").fetchone()[0],100)
    def test_multi_line_failure_rolls_back_order_and_stock(self):
        with self.connect() as db:
            db.execute("INSERT INTO ticket_types(id,event_id,name,price,capacity) VALUES('b','e','Balcon',3000,1)")
        db=self.connect()
        try:
            with db:
                self.hold(db,"multi",2)
                db.execute("INSERT INTO order_items(id,order_id,type_id,quantity,unit_price) VALUES('line2','multi','b',2,3000)")
        except sqlite3.IntegrityError:
            pass
        self.assertEqual(db.execute("SELECT held FROM ticket_types WHERE id='t'").fetchone()[0],0)
        self.assertEqual(db.execute("SELECT count(*) FROM orders").fetchone()[0],0)
        db.close()
    def test_duplicate_payment_and_second_payment_cannot_issue_more_tickets(self):
        with self.connect() as db:
            self.hold(db,"o",2)
            self.pay(db,"o",qty=2)
        with self.connect() as db:
            with self.assertRaises(sqlite3.IntegrityError):
                self.pay(db,"o",qty=2)
            with self.assertRaisesRegex(sqlite3.IntegrityError,"PAYMENT_DUPLICATE"):
                self.pay(db,"o",payment="another-payment",qty=2)
            with self.assertRaisesRegex(sqlite3.IntegrityError,"TICKET_LIMIT"):
                db.execute("INSERT INTO tickets(id,order_id,type_id,code) VALUES('extra','o','t','invented')")
            self.assertEqual(db.execute("SELECT count(*) FROM tickets").fetchone()[0],2)
    def test_expiry_and_late_payment_reacquire_stock(self):
        with self.connect() as db:
            self.hold(db,"old",1)
            db.execute("UPDATE orders SET status='expired' WHERE id='old'")
            self.assertEqual(db.execute("SELECT held FROM ticket_types").fetchone()[0],0)
            self.pay(db,"old")
            self.assertEqual(db.execute("SELECT sold,held FROM ticket_types").fetchone(),(1,0))
    def test_late_payment_when_full_rolls_back_for_refund(self):
        with self.connect() as db:
            self.hold(db,"late")
            db.execute("UPDATE orders SET status='expired' WHERE id='late'")
            self.hold(db,"fill",100)
            self.pay(db,"fill",qty=100)
        db=self.connect()
        with self.assertRaisesRegex(sqlite3.IntegrityError,"STOCK_UNAVAILABLE"):
            with db:
                self.pay(db,"late")
        self.assertEqual(db.execute("SELECT count(*) FROM payments WHERE order_id='late'").fetchone()[0],0)
        self.assertEqual(db.execute("SELECT sold FROM ticket_types").fetchone()[0],100)
        db.close()
    def test_partial_cancellation_releases_one_seat_once(self):
        with self.connect() as db:
            self.hold(db,"o",2)
            self.pay(db,"o",qty=2)
            db.execute("UPDATE tickets SET status='cancelled' WHERE id='o-0'")
            db.execute("UPDATE tickets SET status='cancelled' WHERE id='o-0'")
            self.assertEqual(db.execute("SELECT sold,held FROM ticket_types").fetchone(),(1,0))
    def test_concurrent_scans_accept_exactly_once(self):
        with self.connect() as db:
            self.hold(db,"o")
            self.pay(db,"o")
        def scan(n):
            db=self.connect()
            with db:
                result=db.execute("UPDATE tickets SET scanned_at=?,device_id=? WHERE id='o-0' AND status='valid' AND scanned_at IS NULL",(n+1,str(n))).rowcount
            db.close()
            return result
        with concurrent.futures.ThreadPoolExecutor(max_workers=32) as pool:
            self.assertEqual(sum(pool.map(scan,range(100))),1)
    def test_cancelled_ticket_is_rejected(self):
        with self.connect() as db:
            self.hold(db,"o")
            self.pay(db,"o")
            db.execute("UPDATE tickets SET status='cancelled' WHERE id='o-0'")
            self.assertEqual(db.execute("UPDATE tickets SET scanned_at=100 WHERE id='o-0' AND status='valid' AND scanned_at IS NULL").rowcount,0)

if __name__=="__main__":
    unittest.main(verbosity=2)
