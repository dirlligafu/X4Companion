/** Réponse de `inspect_player_ship` (Tauri). */
export interface ShipInspect {
  code: string;
  name: string | null;
  macro: string;
  class: string;
  state: string | null;
  connection: string | null;
  thruster: string | null;
  software: string[];
  orders: ShipOrderLine[];
  people: ShipPersonLine[];
  people_by_role: Record<string, ShipPersonLine[]>;
  shields: string[];
  weapons: string[];
  turrets: string[];
  engines: string[];
  control_posts: ControlPostLine[];
  other_components: OtherShipComponent[];
}

export interface ShipOrderLine {
  order: string;
  state?: string | null;
  default?: boolean | null;
}

export interface ShipPersonLine {
  role: string;
  macro: string;
  piloting: number;
  management: number;
  morale: number;
  engineering: number;
  boarding: number;
}

export interface ControlPostLine {
  id: string;
  component?: string | null;
  name?: string | null;
}

export interface OtherShipComponent {
  class: string;
  macro: string;
}
