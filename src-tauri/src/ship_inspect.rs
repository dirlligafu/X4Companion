//! Inspection structurée d'un vaisseau joueur (une passe streaming, sans reconstruire tout le XML).

use flate2::read::GzDecoder;
use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

#[derive(Debug, Default, Serialize, Clone)]
pub struct ShipOrderLine {
    pub order: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
}

#[derive(Debug, Default, Serialize, Clone)]
pub struct ShipPersonLine {
    pub role: String,
    #[serde(rename = "macro")]
    pub macro_id: String,
    pub piloting: u8,
    pub management: u8,
    pub morale: u8,
    pub engineering: u8,
    pub boarding: u8,
}

#[derive(Debug, Default, Serialize, Clone)]
pub struct ControlPostLine {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component: Option<String>,
    /// Nom résolu du composant (NPC) si disponible
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Default, Serialize, Clone)]
pub struct OtherShipComponent {
    pub class: String,
    #[serde(rename = "macro")]
    pub macro_id: String,
}

#[derive(Debug, Serialize)]
pub struct ShipInspect {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "macro")]
    pub macro_id: String,
    #[serde(rename = "class")]
    pub ship_class: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thruster: Option<String>,
    pub software: Vec<String>,
    pub orders: Vec<ShipOrderLine>,
    pub people: Vec<ShipPersonLine>,
    /// Groupement par `role` (service, marine, …)
    pub people_by_role: HashMap<String, Vec<ShipPersonLine>>,
    pub shields: Vec<String>,
    pub weapons: Vec<String>,
    pub turrets: Vec<String>,
    pub engines: Vec<String>,
    pub control_posts: Vec<ControlPostLine>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub other_components: Vec<OtherShipComponent>,
}

fn is_target_player_ship(start: &BytesStart<'_>, target_code: &str) -> bool {
    let mut class_ok = false;
    let mut owner_ok = false;
    let mut code_ok = false;
    for attr in start.attributes().flatten() {
        let k = attr.key.as_ref();
        let v = attr.value.as_ref();
        if k == b"class" {
            class_ok = std::str::from_utf8(v)
                .map(|s| s.starts_with("ship_"))
                .unwrap_or(false);
        } else if k == b"owner" {
            owner_ok = v == b"player";
        } else if k == b"code" {
            code_ok = std::str::from_utf8(v)
                .map(|s| s == target_code)
                .unwrap_or(false);
        }
    }
    class_ok && owner_ok && code_ok
}

fn attr_str(e: &BytesStart<'_>, key: &[u8]) -> Option<String> {
    for a in e.attributes().flatten() {
        if a.key.as_ref() == key {
            return Some(
                std::str::from_utf8(a.value.as_ref())
                    .unwrap_or("")
                    .to_string(),
            );
        }
    }
    None
}

fn strip_macro_suffix(s: &str) -> String {
    s.strip_suffix("_macro").unwrap_or(s).to_string()
}

fn apply_skills_attrs(p: &mut ShipPersonLine, e: &BytesStart<'_>) {
    p.piloting = attr_str(e, b"piloting")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    p.management = attr_str(e, b"management")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    p.morale = attr_str(e, b"morale")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    p.engineering = attr_str(e, b"engineering")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    p.boarding = attr_str(e, b"boarding")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
}

fn should_skip_root_tag(name: &[u8]) -> bool {
    matches!(
        name,
        b"listeners"
            | b"render"
            | b"events"
            | b"movement"
            | b"gravidar"
            | b"modification"
            | b"offset"
            | b"stats"
    )
}

fn push_equipment(
    class: &str,
    macro_raw: &str,
    shields: &mut Vec<String>,
    weapons: &mut Vec<String>,
    turrets: &mut Vec<String>,
    engines: &mut Vec<String>,
    other: &mut Vec<OtherShipComponent>,
) {
    let mid = strip_macro_suffix(macro_raw);
    if mid.is_empty() {
        return;
    }
    match class {
        "shieldgenerator" => shields.push(mid),
        "weapon" => weapons.push(mid),
        "turret" => turrets.push(mid),
        "engine" => engines.push(mid),
        _ => other.push(OtherShipComponent {
            class: class.to_string(),
            macro_id: mid,
        }),
    }
}

/// Parse une save, extrait le premier vaisseau joueur avec ce `code`, remplit `ShipInspect`.
pub fn inspect_player_ship(save_path: &str, ship_code: &str) -> Result<ShipInspect, String> {
    let path = Path::new(save_path);
    if !path.is_file() {
        return Err("Fichier de sauvegarde introuvable.".to_string());
    }
    let file = File::open(path).map_err(|e| e.to_string())?;

    let reader_inner: Box<dyn std::io::BufRead> = if save_path.ends_with(".gz") {
        Box::new(BufReader::new(GzDecoder::new(file)))
    } else {
        Box::new(BufReader::new(file))
    };

    let mut reader = Reader::from_reader(reader_inner);
    reader.config_mut().trim_text(false);

    let mut buf = Vec::new();
    let mut comp_depth: u32 = 0;
    let mut skip_depth: u32 = 0;

    let mut code = String::new();
    let mut name: Option<String> = None;
    let mut macro_id = String::new();
    let mut ship_class = String::new();
    let mut state: Option<String> = None;
    let mut connection: Option<String> = None;
    let mut thruster: Option<String> = None;

    let mut software: Vec<String> = Vec::new();
    let mut orders: Vec<ShipOrderLine> = Vec::new();
    let mut people: Vec<ShipPersonLine> = Vec::new();
    let mut shields: Vec<String> = Vec::new();
    let mut weapons: Vec<String> = Vec::new();
    let mut turrets: Vec<String> = Vec::new();
    let mut engines: Vec<String> = Vec::new();
    let mut other_components: Vec<OtherShipComponent> = Vec::new();
    let mut control_posts: Vec<ControlPostLine> = Vec::new();

    let mut people_stack: u32 = 0;
    let mut orders_stack: u32 = 0;
    let mut control_stack: u32 = 0;

    let mut person: Option<ShipPersonLine> = None;
    let mut found_ship = false;
    // id XML → nom : pour résoudre les references des control posts
    let mut name_by_id: HashMap<String, String> = HashMap::new();

    loop {
        let ev = reader
            .read_event_into(&mut buf)
            .map_err(|e| format!("Erreur XML : {e}"))?;

        match ev {
            Event::Eof => break,

            Event::Start(ref e) => {
                if skip_depth > 0 {
                    skip_depth += 1;
                    buf.clear();
                    continue;
                }

                let tag = e.name();
                let n = tag.as_ref();

                if n == b"component" {
                    if comp_depth == 0 {
                        if is_target_player_ship(e, ship_code) {
                            found_ship = true;
                            comp_depth = 1;
                            code = attr_str(e, b"code").unwrap_or_default();
                            name = attr_str(e, b"name").filter(|s| !s.is_empty());
                            macro_id = attr_str(e, b"macro").unwrap_or_default();
                            ship_class = attr_str(e, b"class").unwrap_or_default();
                            state = attr_str(e, b"state").filter(|s| !s.is_empty());
                            connection = attr_str(e, b"connection").filter(|s| !s.is_empty());
                            thruster = attr_str(e, b"thruster")
                                .map(|s| strip_macro_suffix(&s))
                                .filter(|s| !s.is_empty());
                        }
                    } else {
                        // Collecter id → name pour résoudre les control posts
                        if let (Some(cid), Some(cname)) = (attr_str(e, b"id"), attr_str(e, b"name")) {
                            if !cid.is_empty() && !cname.is_empty() {
                                name_by_id.insert(cid, cname);
                            }
                        }
                        let cls = attr_str(e, b"class").unwrap_or_default();
                        let mac = attr_str(e, b"macro").unwrap_or_default();
                        if comp_depth >= 1 && !cls.is_empty() && !mac.is_empty() {
                            push_equipment(
                                &cls,
                                &mac,
                                &mut shields,
                                &mut weapons,
                                &mut turrets,
                                &mut engines,
                                &mut other_components,
                            );
                        }
                        comp_depth += 1;
                    }
                    buf.clear();
                    continue;
                }

                if comp_depth == 0 {
                    buf.clear();
                    continue;
                }

                if should_skip_root_tag(n) {
                    skip_depth = 1;
                    buf.clear();
                    continue;
                }

                if n == b"people" {
                    people_stack += 1;
                } else if n == b"person" && people_stack > 0 {
                    person = Some(ShipPersonLine {
                        role: attr_str(e, b"role").unwrap_or_default(),
                        macro_id: strip_macro_suffix(
                            &attr_str(e, b"macro").unwrap_or_default(),
                        ),
                        ..Default::default()
                    });
                } else if n == b"skills" {
                    if let Some(ref mut p) = person {
                        apply_skills_attrs(p, e);
                    }
                } else if n == b"orders" {
                    orders_stack += 1;
                } else if n == b"order" && orders_stack > 0 {
                    let ord = attr_str(e, b"order").unwrap_or_default();
                    if !ord.is_empty() {
                        let def = attr_str(e, b"default")
                            .map(|s| s == "1" || s.eq_ignore_ascii_case("true"));
                        orders.push(ShipOrderLine {
                            order: ord,
                            state: attr_str(e, b"state").filter(|s| !s.is_empty()),
                            default: def,
                        });
                    }
                } else if n == b"control" {
                    control_stack += 1;
                }
            }

            Event::End(ref e) => {
                if skip_depth > 0 {
                    skip_depth -= 1;
                    buf.clear();
                    continue;
                }

                let tag = e.name();
                let n = tag.as_ref();

                if n == b"component" && comp_depth > 0 {
                    comp_depth -= 1;
                    if comp_depth == 0 {
                        break;
                    }
                    buf.clear();
                    continue;
                }

                if comp_depth == 0 {
                    buf.clear();
                    continue;
                }

                if n == b"people" && people_stack > 0 {
                    people_stack -= 1;
                } else if n == b"person" && person.is_some() {
                    if let Some(p) = person.take() {
                        people.push(p);
                    }
                } else if n == b"orders" && orders_stack > 0 {
                    orders_stack -= 1;
                } else if n == b"control" && control_stack > 0 {
                    control_stack -= 1;
                }
            }

            Event::Empty(ref e) if skip_depth == 0 && comp_depth > 0 => {
                let tag = e.name();
                let n = tag.as_ref();
                if n == b"software" && comp_depth == 1 {
                    if let Some(wares) = attr_str(e, b"wares") {
                        software.extend(
                            wares
                                .split_whitespace()
                                .map(|s| s.to_string())
                                .filter(|s| !s.is_empty()),
                        );
                    }
                } else if n == b"skills" {
                    if let Some(ref mut p) = person {
                        apply_skills_attrs(p, e);
                    }
                } else if n == b"order" && orders_stack > 0 {
                    let ord = attr_str(e, b"order").unwrap_or_default();
                    if !ord.is_empty() {
                        let def = attr_str(e, b"default")
                            .map(|s| s == "1" || s.eq_ignore_ascii_case("true"));
                        orders.push(ShipOrderLine {
                            order: ord,
                            state: attr_str(e, b"state").filter(|s| !s.is_empty()),
                            default: def,
                        });
                    }
                } else if n == b"post" && control_stack > 0 {
                    let id = attr_str(e, b"id").unwrap_or_default();
                    if !id.is_empty() {
                        control_posts.push(ControlPostLine {
                            id,
                            component: attr_str(e, b"component").filter(|s| !s.is_empty()),
                            name: None,
                        });
                    }
                } else if n == b"component" && comp_depth >= 1 {
                    // Collecter id → name pour résoudre les control posts
                    if let (Some(cid), Some(cname)) = (attr_str(e, b"id"), attr_str(e, b"name")) {
                        if !cid.is_empty() && !cname.is_empty() {
                            name_by_id.insert(cid, cname);
                        }
                    }
                    let cls = attr_str(e, b"class").unwrap_or_default();
                    let mac = attr_str(e, b"macro").unwrap_or_default();
                    if !cls.is_empty() && !mac.is_empty() {
                        push_equipment(
                            &cls,
                            &mac,
                            &mut shields,
                            &mut weapons,
                            &mut turrets,
                            &mut engines,
                            &mut other_components,
                        );
                    }
                }
            }

            _ => {}
        }
        buf.clear();
    }

    if !found_ship || code.is_empty() {
        return Err(format!(
            "Aucun vaisseau joueur trouvé avec le code « {ship_code} »."
        ));
    }

    // Résoudre les noms des control posts via name_by_id
    for post in &mut control_posts {
        if let Some(ref comp) = post.component {
            if let Some(n) = name_by_id.get(comp) {
                post.name = Some(n.clone());
            }
        }
    }

    let mut people_by_role: HashMap<String, Vec<ShipPersonLine>> = HashMap::new();
    for p in &people {
        let k = if p.role.is_empty() {
            "unknown".to_string()
        } else {
            p.role.clone()
        };
        people_by_role.entry(k).or_default().push(p.clone());
    }

    Ok(ShipInspect {
        code,
        name,
        macro_id: strip_macro_suffix(&macro_id),
        ship_class,
        state,
        connection,
        thruster,
        software,
        orders,
        people,
        people_by_role,
        shields,
        weapons,
        turrets,
        engines,
        control_posts,
        other_components,
    })
}
