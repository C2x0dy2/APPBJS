import AppTabs from "@/components/app-tabs";
import { TabConfig } from "@/components/tab-config";

const ORGANIZER_TABS: TabConfig[] = [
  { name: "index", href: "/organizer", label: "Mes événements", sf: "calendar", md: "event" },
  { name: "dashboard", href: "/organizer/dashboard", label: "Tableau de bord", sf: "chart.bar", md: "bar_chart" },
  { name: "account", href: "/organizer/account", label: "Compte", sf: "person.circle", md: "account_circle" },
];

export default function OrganizerTabsLayout() {
  return <AppTabs tabs={ORGANIZER_TABS} />;
}
