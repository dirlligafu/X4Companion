//! Injection d'un vaisseau joueur dans une save X4 existante.
//!
//! Pipeline :
//!   1. scan_max_hex_id     — passe rapide pour trouver le max des [0xXXXXX] dans la save
//!   2. find_player_location — tempzone ID + position x,z du premier ship joueur non-docké
//!   3. prepare_ship_xml    — remplace IDs, code, position dans le template
//!   4. inject_into_save    — passe streaming : injecte dans la tempzone exacte du joueur

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::fs;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};

// ── 1. Scan max hex ID ────────────────────────────────────────────────────────

/// Parcourt la save ligne par ligne et renvoie le plus grand [0xXXXX] trouvé.
pub fn scan_max_hex_id(path: &str) -> Result<u64, String> {
    let file = File::open(path).map_err(|e| format!("Impossible d'ouvrir : {e}"))?;
    let reader: Box<dyn BufRead> = if path.ends_with(".gz") {
        Box::new(BufReader::new(GzDecoder::new(file)))
    } else {
        Box::new(BufReader::new(file))
    };

    let mut max_id: u64 = 0;

    for line_result in reader.lines() {
        let line = line_result.map_err(|e| format!("Erreur lecture : {e}"))?;
        let mut s = line.as_str();
        while let Some(pos) = s.find("[0x") {
            let after = &s[pos + 3..];
            let end = after.find(']').unwrap_or(after.len());
            let hex = &after[..end];
            if !hex.is_empty() {
                if let Ok(val) = u64::from_str_radix(hex, 16) {
                    if val > max_id {
                        max_id = val;
                    }
                }
            }
            s = &s[pos + 3..];
        }
    }

    Ok(max_id)
}

// ── 2. Localisation du joueur ────────────────────────────────────────────────

pub struct PlayerLocation {
    pub tempzone_id: String, // ex. "[0x57c56]"
    pub x: f64,
    pub z: f64,
    pub occupied: Vec<(f64, f64)>, // positions des ships déjà dans la tempzone
}

/// Passe 1 rapide : cherche `class="player" lastcontrolled="[0xXXXX]"` et retourne l'ID du vaisseau piloté.
fn find_player_ship_id(path: &str) -> Option<String> {
    let file = File::open(path).ok()?;
    let reader: Box<dyn BufRead> = if path.ends_with(".gz") {
        Box::new(BufReader::new(GzDecoder::new(file)))
    } else {
        Box::new(BufReader::new(file))
    };
    for line_result in reader.lines() {
        let line = line_result.ok()?;
        if line.contains("class=\"player\"") && line.contains("lastcontrolled=") {
            return extract_attr(&line, "lastcontrolled");
        }
    }
    None
}

/// Renvoie l'ID de zone, la position x,z du joueur, et les positions de tous les
/// ships déjà présents dans la même zone (pour éviter les collisions à l'injection).
pub fn find_player_location(path: &str) -> Result<PlayerLocation, String> {
    // Passe 1 : identifie le vaisseau piloté via l'entité class="player"
    let player_ship_id = find_player_ship_id(path);

    let file = File::open(path).map_err(|e| format!("Impossible d'ouvrir : {e}"))?;
    let reader: Box<dyn BufRead> = if path.ends_with(".gz") {
        Box::new(BufReader::new(GzDecoder::new(file)))
    } else {
        Box::new(BufReader::new(file))
    };

    enum Stage {
        Searching,
        FoundShip,
        PastMovement,
        CollectShips,
        CollectShipMovement,
        CollectShipPos,
    }
    let mut stage = Stage::Searching;
    let mut current_zone_id = String::new();
    let mut player_x = 0.0_f64;
    let mut player_z = 0.0_f64;
    let mut found_zone_id = String::new();
    let mut occupied: Vec<(f64, f64)> = Vec::new();

    for line_result in reader.lines() {
        let line = line_result.map_err(|e| format!("Erreur lecture : {e}"))?;
        let t = line.trim_start();

        match stage {
            Stage::Searching => {
                if t.contains("class=\"zone\"") {
                    if let Some(id) = extract_attr(t, "id") {
                        current_zone_id = id;
                    }
                }
                let is_player_ship = match &player_ship_id {
                    // Si on a l'ID exact, on cherche ce composant précis
                    Some(sid) => t.contains("class=\"ship_")
                        && t.contains(&format!("id=\"{}\"", sid)),
                    // Fallback : premier ship owner="player" connection="space"
                    None => t.contains("owner=\"player\"")
                        && t.contains("class=\"ship_")
                        && t.contains("connection=\"space\""),
                };
                if is_player_ship && !current_zone_id.is_empty() {
                    found_zone_id = current_zone_id.clone();
                    stage = Stage::FoundShip;
                }
            }
            Stage::FoundShip => {
                if t.starts_with("</movement>") {
                    stage = Stage::PastMovement;
                }
            }
            Stage::PastMovement => {
                if t.starts_with("<position") && t.contains("x=") {
                    player_x = extract_attr(t, "x").and_then(|v| v.parse().ok()).unwrap_or(0.0);
                    player_z = extract_attr(t, "z").and_then(|v| v.parse().ok()).unwrap_or(0.0);
                    stage = Stage::CollectShips;
                }
            }
            // Collecte des positions des ships restants dans la même tempzone.
            // On s'arrête dès qu'on voit une nouvelle zone ou un secteur.
            Stage::CollectShips => {
                if t.starts_with("<component")
                    && (t.contains("class=\"zone\"") || t.contains("class=\"sector\""))
                {
                    break;
                }
                if t.contains("class=\"ship_") && t.contains("connection=\"space\"") {
                    stage = Stage::CollectShipMovement;
                }
            }
            Stage::CollectShipMovement => {
                if t.starts_with("</movement>") {
                    stage = Stage::CollectShipPos;
                }
            }
            Stage::CollectShipPos => {
                if t.starts_with("<position") && t.contains("x=") {
                    let sx = extract_attr(t, "x").and_then(|v| v.parse().ok()).unwrap_or(0.0);
                    let sz = extract_attr(t, "z").and_then(|v| v.parse().ok()).unwrap_or(0.0);
                    occupied.push((sx, sz));
                    stage = Stage::CollectShips;
                }
            }
        }
    }

    if found_zone_id.is_empty() {
        return Err("Aucun ship joueur non-docké trouvé dans la save.".to_string());
    }

    Ok(PlayerLocation { tempzone_id: found_zone_id, x: player_x, z: player_z, occupied })
}

/// Cherche un slot libre autour de (base_x, base_z) à au moins `min_dist` mètres
/// de chaque position dans `occupied`. Essaie 12 angles × 3 distances, puis fallback 2000m.
pub fn pick_position(base_x: f64, base_z: f64, occupied: &[(f64, f64)], seed: u64, min_dist: f64) -> (f64, f64) {
    use std::f64::consts::PI;
    let distances = [600.0_f64, 900.0, 1300.0];
    let n_angles = 12_u64;
    let angle_offset = (seed % n_angles) as f64 / n_angles as f64;

    for &dist in &distances {
        for i in 0..n_angles {
            let angle = 2.0 * PI * (i as f64 / n_angles as f64 + angle_offset);
            let x = base_x + dist * angle.cos();
            let z = base_z + dist * angle.sin();
            if occupied.iter().all(|&(ox, oz)| {
                let dx = x - ox;
                let dz = z - oz;
                dx * dx + dz * dz >= min_dist * min_dist
            }) {
                return (x, z);
            }
        }
    }

    // Fallback : 2000m dans une direction basée sur le seed
    let angle = 2.0 * PI * (seed % 360) as f64 / 360.0;
    (base_x + 2000.0 * angle.cos(), base_z + 2000.0 * angle.sin())
}

/// Extrait la valeur d'un attribut XML depuis une ligne (ex. macro="cluster_14_sector001_macro").
fn extract_attr(line: &str, attr: &str) -> Option<String> {
    let needle = format!("{}=\"", attr);
    let start = line.find(&needle)? + needle.len();
    let end = line[start..].find('"')? + start;
    Some(line[start..end].to_string())
}

// ── 3. Préparation du XML template ───────────────────────────────────────────

/// Supprime l'équipage du template : bloc <people>, NPC nommé dans le cockpit,
/// et nettoie la référence aipilot dans <control>.
fn strip_crew(xml: &str) -> String {
    let mut result = Vec::new();
    let mut skip_depth: Option<i32> = None;

    for line in xml.lines() {
        let t = line.trim_start();

        // ── <connection connection="entities"> (NPC nommé dans le cockpit) ──
        if skip_depth.is_none()
            && t.starts_with("<connection")
            && !t.starts_with("<connections")
            && t.contains("connection=\"entities\"")
        {
            skip_depth = Some(1);
            continue;
        }
        if let Some(ref mut depth) = skip_depth {
            if t.starts_with("<connection") && !t.starts_with("<connections") && !t.ends_with("/>") {
                *depth += 1;
            }
            if t.starts_with("</connection>") {
                *depth -= 1;
                if *depth == 0 {
                    skip_depth = None;
                }
            }
            continue;
        }

        // ── Nettoyer <post id="aipilot" component="..."/> → <post id="aipilot" /> ──
        if t.contains("id=\"aipilot\"") && t.contains("component=") {
            let fixed = remove_attr(line, "component");
            result.push(fixed);
            continue;
        }

        result.push(line.to_string());
    }
    result.join("\n")
}

/// Supprime un attribut XML d'une ligne (ex. component="[0x...]").
fn remove_attr(line: &str, attr: &str) -> String {
    let needle = format!(" {}=\"", attr);
    if let Some(start) = line.find(&needle) {
        let after = &line[start + needle.len()..];
        if let Some(end) = after.find('"') {
            let mut s = line.to_string();
            s.replace_range(start..start + needle.len() + end + 1, "");
            return s;
        }
    }
    line.to_string()
}

/// Remplace les <position x=... z=...> sans y= (positions absolues) par les nouvelles coords.
fn set_ship_position(xml: &str, x: f64, z: f64) -> String {
    let mut result = Vec::new();
    for line in xml.lines() {
        let t = line.trim_start();
        if t.starts_with("<position") && t.contains("x=") && !t.contains("y=") {
            let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
            result.push(format!("{}<position x=\"{:.3}\" z=\"{:.3}\" />", indent, x, z));
        } else {
            result.push(line.to_string());
        }
    }
    result.join("\n")
}

/// Remplace les IDs définis sur des éléments structurels (<component, <connection) du template
/// par de nouveaux IDs (next_id incrémenté), et le premier `code="XXX-000"` par new_code.
/// Les références externes comme <account id="[0x88]"> sont préservées.
pub fn prepare_ship_xml(template_xml: &str, new_code: &str, next_id: &mut u64, x: f64, z: f64) -> String {
    // ── Suppression de l'équipage ──
    let template_xml = strip_crew(template_xml);
    // ── Position ──
    let template_xml = set_ship_position(&template_xml, x, z);
    let template_xml = template_xml.as_str();

    // ── Collecte des IDs définis sur éléments structurels uniquement ──
    // On ignore <account id=>, <weapon id=>, etc. qui sont des références externes.
    let mut old_ids: Vec<String> = Vec::new();
    for line in template_xml.lines() {
        let t = line.trim_start();
        if t.starts_with("<component") || t.starts_with("<connection") {
            if let Some(id_val) = extract_attr(t, "id") {
                if !old_ids.contains(&id_val) {
                    old_ids.push(id_val);
                }
            }
        }
    }

    // ── Mapping old → new ──
    let mut mapping: Vec<(String, String)> = Vec::new();
    for old in old_ids {
        let new = format!("[0x{:x}]", *next_id);
        mapping.push((old, new));
        *next_id += 1;
    }

    // ── Application des remplacements ──
    let mut result = template_xml.to_string();
    for (old, new) in &mapping {
        result = result.replace(old.as_str(), new.as_str());
    }

    // ── Remplacement du code du vaisseau (premier code="XXX-NNN") ──
    if let Some(code_start) = result.find("code=\"") {
        let after = &result[code_start + 6..];
        if let Some(end_quote) = after.find('"') {
            let old_code = after[..end_quote].to_string();
            result = result.replacen(
                &format!("code=\"{}\"", old_code),
                &format!("code=\"{}\"", new_code),
                1,
            );
        }
    }

    result
}

// ── 3. Injection streaming ────────────────────────────────────────────────────

/// Injecte un ou plusieurs ship_xmls dans la tempzone identifiée par `tempzone_id`
/// en une seule passe streaming. Crée un backup .bak si absent, écrit dans .tmp,
/// puis remplace atomiquement.
pub fn inject_into_save_batch(save_path: &str, ship_xmls: &[String], tempzone_id: &str) -> Result<(), String> {
    let injection = ship_xmls
        .iter()
        .map(|xml| format!("<connection connection=\"ships\">\n{}\n</connection>", xml))
        .collect::<Vec<_>>()
        .join("\n");
    inject_into_save(save_path, &injection, tempzone_id)
}

/// Injecte un bloc XML brut dans la tempzone identifiée par `tempzone_id`.
pub fn inject_into_save(save_path: &str, injection_block: &str, tempzone_id: &str) -> Result<(), String> {
    let is_gz = save_path.ends_with(".gz");

    // Backup — créé une seule fois (avant la première injection)
    let backup = format!("{}.bak", save_path);
    if !std::path::Path::new(&backup).exists() {
        fs::copy(save_path, &backup)
            .map_err(|e| format!("Backup impossible : {e}"))?;
    }

    let tmp = format!("{}.tmp", save_path);

    {
        let src = File::open(save_path)
            .map_err(|e| format!("Ouverture save impossible : {e}"))?;
        let dst = File::create(&tmp)
            .map_err(|e| format!("Création .tmp impossible : {e}"))?;

        if is_gz {
            let reader = BufReader::new(GzDecoder::new(BufReader::new(src)));
            let mut encoder = GzEncoder::new(BufWriter::new(dst), Compression::default());
            write_with_injection(reader, &mut encoder, injection_block, tempzone_id)?;
            encoder.finish().map_err(|e| format!("Finalisation gz : {e}"))?;
        } else {
            let reader = BufReader::new(src);
            let mut writer = BufWriter::new(dst);
            write_with_injection(reader, &mut writer, injection_block, tempzone_id)?;
            writer.flush().map_err(|e| format!("Flush : {e}"))?;
        }
    }

    fs::rename(&tmp, save_path)
        .map_err(|e| format!("Remplacement atomique impossible : {e}"))?;

    Ok(())
}

// ── Moteur de streaming ───────────────────────────────────────────────────────

enum InjectState {
    Scanning,
    InTempzone { connections_depth: i32, zone_id: String },
    Done,
}

/// Replaces every `attr="[0xXXXX]"` hex value in `xml` for the given attribute name.
fn replace_hex_attr(xml: &str, attr: &str, new_val: &str) -> String {
    let needle = format!("{}=\"[0x", attr);
    let prefix_len = attr.len() + 2; // attr + ="
    let mut result = String::with_capacity(xml.len());
    let mut rest = xml;
    while let Some(pos) = rest.find(&needle) {
        result.push_str(&rest[..pos + prefix_len]); // up to and including attr="
        result.push_str(new_val);
        result.push('"');
        let after = &rest[pos + needle.len()..]; // after the [0x
        if let Some(end) = after.find('"') {
            rest = &after[end + 1..]; // skip old hex value + closing "
        } else {
            rest = after;
            break;
        }
    }
    result.push_str(rest);
    result
}

/// Fixes stale zone references inside the `<movement>` block of the injected ship XML.
fn fix_movement_zone_refs(xml: &str, new_zone_id: &str) -> String {
    let mov_start = match xml.find("<movement") {
        Some(p) => p,
        None => return xml.to_string(),
    };
    let mov_end = match xml.find("</movement>") {
        Some(p) => p + "</movement>".len(),
        None => return xml.to_string(),
    };

    let before = &xml[..mov_start];
    let movement = &xml[mov_start..mov_end];
    let after = &xml[mov_end..];

    let fixed = replace_hex_attr(movement, "space", new_zone_id);
    let fixed = replace_hex_attr(&fixed, "refobject", new_zone_id);

    format!("{}{}{}", before, fixed, after)
}

fn write_with_injection<R: BufRead, W: Write>(
    reader: R,
    writer: &mut W,
    injection: &str,
    tempzone_id: &str,
) -> Result<(), String> {
    let mut state = InjectState::Scanning;

    for line_result in reader.lines() {
        let line = line_result.map_err(|e| format!("Erreur lecture : {e}"))?;
        let trimmed = line.trim_start();

        match state {
            InjectState::Scanning => {
                if trimmed.contains("class=\"zone\"")
                    && trimmed.contains(&format!("id=\"{}\"", tempzone_id))
                    && !trimmed.ends_with("/>")
                {
                    state = InjectState::InTempzone {
                        connections_depth: 0,
                        zone_id: tempzone_id.to_string(),
                    };
                }
                writeln!(writer, "{}", line).map_err(|e| format!("Erreur écriture : {e}"))?;
            }

            InjectState::InTempzone { ref mut connections_depth, ref zone_id } => {
                if trimmed.starts_with("<connections") && !trimmed.contains("/>") {
                    *connections_depth += 1;
                }

                if trimmed.starts_with("</connections>") {
                    *connections_depth -= 1;
                    if *connections_depth == 0 {
                        let fixed = fix_movement_zone_refs(injection, zone_id);
                        writeln!(writer, "{}", fixed)
                            .map_err(|e| format!("Erreur injection : {e}"))?;
                        state = InjectState::Done;
                    }
                }

                writeln!(writer, "{}", line).map_err(|e| format!("Erreur écriture : {e}"))?;
            }

            InjectState::Done => {
                writeln!(writer, "{}", line).map_err(|e| format!("Erreur écriture : {e}"))?;
            }
        }
    }

    if !matches!(state, InjectState::Done) {
        return Err(format!("Tempzone '{}' introuvable dans la save.", tempzone_id));
    }

    Ok(())
}
