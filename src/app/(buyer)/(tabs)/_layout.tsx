import AppTabs from "@/components/app-tabs";
import { TabConfig } from "@/components/tab-config";

const BUYER_TABS: TabConfig[] = [
  { name: "index", href: "/", label: "Accueil", icon: "home", sf: "house", md: "home" },
  { name: "tickets", href: "/tickets", label: "Mes billets", icon: "ticket", sf: "ticket", md: "confirmation_number" },
  { name: "dashboard", href: "/dashboard", label: "Tableau de bord", icon: "chart", sf: "chart.bar", md: "bar_chart" },
  { name: "account", href: "/account", label: "Compte", icon: "userCircle", sf: "person.circle", md: "account_circle" },
];

export default function BuyerTabsLayout() {
  return <AppTabs tabs={BUYER_TABS} />;
}
