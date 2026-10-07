import AppTabs from "@/components/app-tabs";
import { TabConfig } from "@/components/tab-config";

const BUYER_TABS: TabConfig[] = [
  { name: "index", href: "/", label: "Événements", sf: "calendar", md: "event" },
  { name: "tickets", href: "/tickets", label: "Mes billets", sf: "ticket", md: "confirmation_number" },
  { name: "account", href: "/account", label: "Compte", sf: "person.circle", md: "account_circle" },
];

export default function BuyerTabsLayout() {
  return <AppTabs tabs={BUYER_TABS} />;
}
