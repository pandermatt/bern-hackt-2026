import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUp,
  Banknote,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  ChartNoAxesCombined,
  CircleDollarSign,
  Clock3,
  Copy,
  CreditCard,
  Gauge,
  Layers,
  MapPin,
  PiggyBank,
  Plane,
  RefreshCw,
  Repeat2,
  Store,
  Tag,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Undo2,
  UserPlus,
  Wallet,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { createElement } from "react";

/**
 * The one place a finding's `icon` string becomes a glyph.
 *
 * The engine stores an icon name per finding (`lucide:copy`), so a rule names
 * its own picture once and every surface draws the same one. It lives here
 * rather than in the ledger because `/anomalies` lists the same findings a
 * ledger row badges, and two maps would let a duplicate charge look like two
 * different things depending on which page you were on.
 */
const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  "lucide:arrow-up": ArrowUp,
  "lucide:circle-dollar-sign": CircleDollarSign,
  "lucide:store": Store,
  "lucide:tag": Tag,
  "lucide:repeat-2": Repeat2,
  "lucide:chart-no-axes-combined": ChartNoAxesCombined,
  "lucide:calendar-plus": CalendarPlus,
  "lucide:refresh-cw": RefreshCw,
  "lucide:calendar-x": CalendarX,
  "lucide:clock-3": Clock3,
  "lucide:calendar-clock": CalendarClock,
  "lucide:gauge": Gauge,
  "lucide:copy": Copy,
  "lucide:map-pin": MapPin,
  "lucide:plane": Plane,
  "lucide:user-plus": UserPlus,
  "lucide:arrow-left-right": ArrowLeftRight,
  "lucide:wallet": Wallet,
  "lucide:wallet-cards": WalletCards,
  "lucide:trending-down": TrendingDown,
  "lucide:piggy-bank": PiggyBank,
  "lucide:target": Target,
  "lucide:undo-2": Undo2,
  "lucide:banknote": Banknote,
  "lucide:credit-card": CreditCard,
  "lucide:trending-up": TrendingUp,
  "lucide:layers": Layers,
  "lucide:triangle-alert": TriangleAlert,
};

/** A finding from an older engine keeps its row rather than throwing. */
export function anomalyIcon(name: string): LucideIcon {
  return LUCIDE_ICON_MAP[name] ?? AlertTriangle;
}

/**
 * Always decorative: every caller sets the finding's title in text beside it,
 * so a label here would be read twice.
 */
export function AnomalyIcon({ name, className }: { name: string; className?: string }) {
  // `createElement`, not `<Icon />`: a capitalised local bound to a lookup reads
  // to the React compiler's lint as a component defined during render, which is
  // the pattern that breaks reconciliation — this one is a table read, and the
  // table is module scope.
  return createElement(anomalyIcon(name), { "aria-hidden": true, className });
}
