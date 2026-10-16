// Business archetypes for the generator (docs/EVALS.md §1). Each has two channels: a "counter" channel of many
// small customers and an "accounts" channel of a few business clients, the first of which is the key client a
// price change can lose. Amounts are monthly revenue per channel in the currency's units.

export interface Archetype {
  readonly id: string;
  readonly business: string;
  readonly currency: string;
  /** [counter channel, accounts channel]. */
  readonly channels: readonly [string, string];
  /** Counter-channel customer buckets (walk-in, online…). */
  readonly counter: readonly string[];
  /** Accounts-channel clients; the first is the key client. */
  readonly accounts: readonly string[];
  /** Products: [counter products, accounts products]; the first counter product is the one a launch replaces. */
  readonly products: readonly [readonly string[], readonly string[]];
  /** The product a launch introduces (cannibalization variant). */
  readonly launch: string;
  readonly monthly: { readonly counter: number; readonly accounts: number };
  /** Average order value per channel. */
  readonly order: { readonly counter: number; readonly accounts: number };
  /** What the supplier switch changes (refund variant). */
  readonly supply: string;
  readonly newSupplier: string;
}

export const ARCHETYPES: readonly Archetype[] = [
  {
    id: "coffee_roaster",
    business: "Harbor Coffee Roasters",
    currency: "USD",
    channels: ["retail", "wholesale"],
    counter: ["Shop counter", "Web shop"],
    accounts: ["Seaview Hotels", "Corner Bakery", "Metro Offices", "Campus Cafe"],
    products: [
      ["House blend 250g", "Single origin 250g"],
      ["House blend 1kg", "Espresso blend 1kg"],
    ],
    launch: "Signature blend 250g",
    monthly: { counter: 26000, accounts: 18000 },
    order: { counter: 28, accounts: 320 },
    supply: "coffee bags",
    newSupplier: "PackRight",
  },
  {
    id: "printing_shop",
    business: "Inkwell Print Studio",
    currency: "EUR",
    channels: ["walk-in", "business"],
    counter: ["Counter", "Online orders"],
    accounts: ["Brightline Agency", "City Theatre", "Northgate School", "Pine Dental"],
    products: [
      ["Flyers A5", "Posters A2"],
      ["Brochures", "Business cards"],
    ],
    launch: "Eco flyers A5",
    monthly: { counter: 14000, accounts: 21000 },
    order: { counter: 45, accounts: 600 },
    supply: "paper stock",
    newSupplier: "PaperMill Co",
  },
  {
    id: "clinic",
    business: "Riverside Physio Clinic",
    currency: "USD",
    channels: ["private", "corporate"],
    counter: ["Walk-in patients", "Online bookings"],
    accounts: ["Atlas Logistics", "Bluewater Insurance", "Summit Bank", "Oak Schools"],
    products: [
      ["Initial assessment", "Follow-up session"],
      ["Corporate package", "Ergonomic review"],
    ],
    launch: "Express session",
    monthly: { counter: 32000, accounts: 24000 },
    order: { counter: 85, accounts: 1500 },
    supply: "treatment supplies",
    newSupplier: "MedSource",
  },
  {
    id: "online_store",
    business: "Nordic Home Goods",
    currency: "EUR",
    channels: ["consumer", "trade"],
    counter: ["Website", "Marketplace"],
    accounts: ["Interior Studio Vale", "Hotel Fjord", "Cabin Rentals AS", "Office Fitters"],
    products: [
      ["Linen throw", "Ceramic mug set"],
      ["Bulk towels", "Bulk bedding"],
    ],
    launch: "Wool throw",
    monthly: { counter: 52000, accounts: 30000 },
    order: { counter: 60, accounts: 900 },
    supply: "shipping boxes",
    newSupplier: "BoxCraft",
  },
  {
    id: "distributor",
    business: "Delta Food Distribution",
    currency: "USD",
    channels: ["cash-and-carry", "contract"],
    counter: ["Depot sales", "Phone orders"],
    accounts: ["FreshMart Chain", "Green Grocers", "School Catering", "Hospital Kitchens"],
    products: [
      ["Dry goods case", "Canned goods case"],
      ["Contract dry goods", "Contract frozen goods"],
    ],
    launch: "Organic dry goods case",
    monthly: { counter: 40000, accounts: 90000 },
    order: { counter: 250, accounts: 3500 },
    supply: "pallet wrap",
    newSupplier: "WrapPro",
  },
  {
    id: "restaurant",
    business: "Saffron Kitchen",
    currency: "USD",
    channels: ["dine-in", "catering"],
    counter: ["Lunch service", "Dinner service"],
    accounts: ["Tech Park Offices", "Wedding Planners Ltd", "City Council", "Law Firm Hale"],
    products: [
      ["Lunch menu", "Dinner menu"],
      ["Catering platter", "Event buffet"],
    ],
    launch: "Tasting menu",
    monthly: { counter: 46000, accounts: 22000 },
    order: { counter: 38, accounts: 1100 },
    supply: "takeaway containers",
    newSupplier: "EcoPack",
  },
  {
    id: "saas",
    business: "Ledgerly Software",
    currency: "USD",
    channels: ["self-serve", "enterprise"],
    counter: ["Monthly plans", "Annual plans"],
    accounts: ["Vertex Manufacturing", "Polar Retail", "Quantum Health", "Apex Legal"],
    products: [
      ["Starter plan", "Team plan"],
      ["Enterprise licence", "Premium support"],
    ],
    launch: "Growth plan",
    monthly: { counter: 38000, accounts: 42000 },
    order: { counter: 49, accounts: 4200 },
    supply: "payment processing",
    newSupplier: "PayFlow",
  },
  {
    id: "logistics",
    business: "Swift Courier Services",
    currency: "EUR",
    channels: ["spot", "contract"],
    counter: ["Same-day jobs", "Next-day jobs"],
    accounts: ["Medisupply", "Fashion Hub", "Auto Parts Direct", "Book Distributors"],
    products: [
      ["Same-day delivery", "Next-day delivery"],
      ["Contract route", "Warehouse shuttle"],
    ],
    launch: "Evening delivery",
    monthly: { counter: 30000, accounts: 55000 },
    order: { counter: 32, accounts: 2400 },
    supply: "van leasing",
    newSupplier: "FleetLease",
  },
  {
    id: "construction_supplier",
    business: "Granite Building Supplies",
    currency: "USD",
    channels: ["trade counter", "site accounts"],
    counter: ["Counter sales", "Yard sales"],
    accounts: ["Kestrel Builders", "Hillside Homes", "Metro Renovations", "Bridgeway Civil"],
    products: [
      ["Cement bags", "Timber lengths"],
      ["Site cement", "Site steel"],
    ],
    launch: "Rapid-set cement bags",
    monthly: { counter: 60000, accounts: 85000 },
    order: { counter: 140, accounts: 5200 },
    supply: "cement",
    newSupplier: "StoneWorks",
  },
  {
    id: "agency",
    business: "Brightside Marketing",
    currency: "EUR",
    channels: ["projects", "retainers"],
    counter: ["Small projects", "Workshops"],
    accounts: ["Lumen Cosmetics", "Fjord Outdoor", "Civic Museum", "Spark Energy"],
    products: [
      ["Design project", "Strategy workshop"],
      ["Monthly retainer", "Campaign retainer"],
    ],
    launch: "Content sprint",
    monthly: { counter: 22000, accounts: 48000 },
    order: { counter: 900, accounts: 6000 },
    supply: "freelance copywriting",
    newSupplier: "WordSmiths",
  },
];
