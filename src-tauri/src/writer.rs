use crate::parser::ProgressReader;
use crate::station::{build_storage_cargo_patches, load_module_cargo_map_from_path,
    load_ware_cargo_map_from_path, rebuild_storage_component_block};
use crate::types::*;
use crate::validate_save_path;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use tauri::{Emitter, Manager};
// ── Helpers écriture ─────────────────────────────────────────────────────────

/// Remplace la valeur d'un attribut XML sur une ligne : attr="ancienne" → attr="nouvelle"
fn replace_attr(line: &str, attr: &str, new_val: &str) -> String {
    let pattern = format!("{}=\"", attr);
    if let Some(start) = line.find(&pattern) {
        let val_start = start + pattern.len();
        if let Some(end) = line[val_start..].find('"') {
            let mut s = line.to_string();
            s.replace_range(val_start..val_start + end, new_val);
            return s;
        }
    }
    line.to_string()
}

/// Extrait la valeur d'un attribut XML sur une ligne
fn extract_attr(line: &str, attr: &str) -> Option<String> {
    let pattern = format!("{}=\"", attr);
    let start = line.find(&pattern)? + pattern.len();
    let end = start + line[start..].find('"')?;
    Some(line[start..end].to_string())
}

/// `attr="…"` ou `attr='…'` (balise ouverte courte, ex. `<component …>`)

/// Met à jour ou ajoute l'attribut amount sur une balise <ware>
fn set_ware_amount(line: &str, amount: u32) -> String {
    if line.contains("amount=") {
        replace_attr(line, "amount", &amount.to_string())
    } else {
        // Insère amount="X" avant le /> final
        if let Some(pos) = line.rfind("/>") {
            let mut s = line.to_string();
            s.insert_str(pos, &format!(" amount=\"{}\"", amount));
            s
        } else {
            line.to_string()
        }
    }
}

fn clamp_skill15(v: u8) -> u8 {
    v.min(15)
}

fn line_opens_player_npc_component(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("<component")
        && t.contains("class=\"npc\"")
        && (t.contains("owner=\"player\"") || t.contains("owner='player'"))
}

fn npc_skills_xml_line(indent: &str, s: &NpcSkillsEdit) -> String {
    format!(
        r#"{indent}<skills piloting="{}" management="{}" morale="{}" engineering="{}" boarding="{}"/>"#,
        clamp_skill15(s.piloting),
        clamp_skill15(s.management),
        clamp_skill15(s.morale),
        clamp_skill15(s.engineering),
        clamp_skill15(s.boarding),
    )
}

/// Bloc compact comme dans les saves : `<traits …><skills … /></traits>` sur une ligne.
fn npc_traits_skills_one_line(indent: &str, s: &NpcSkillsEdit) -> String {
    let p = clamp_skill15(s.piloting);
    let m = clamp_skill15(s.management);
    let mo = clamp_skill15(s.morale);
    let e = clamp_skill15(s.engineering);
    let b = clamp_skill15(s.boarding);
    format!(
        r#"{indent}<traits flags="remotecommable"><skills boarding="{b}" engineering="{e}" management="{m}" morale="{mo}" piloting="{p}" /></traits>"#
    )
}

/// Balises `<component` (non auto-fermantes) et `</component>` sur une même ligne,
/// dans l'ordre du fichier — aligné sur le compteur `component_depth` du parseur.
fn scan_component_depth_delta(line: &str) -> i32 {
    let mut pos = 0usize;
    let mut delta = 0i32;
    while pos < line.len() {
        let rest = &line[pos..];
        let next_open = rest.find("<component");
        let next_close = rest.find("</component>");
        let take_open = match (next_open, next_close) {
            (Some(o), Some(c)) => o < c,
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => break,
        };
        if take_open {
            let i_open = pos + next_open.unwrap();
            let after_open = &line[i_open..];
            let Some(gt_rel) = after_open.find('>') else {
                pos = i_open + "<component".len();
                continue;
            };
            let gt = i_open + gt_rel;
            let frag = &line[i_open..=gt];
            if !frag.ends_with("/>") {
                delta += 1;
            }
            pos = gt + 1;
        } else {
            let i_close = pos + next_close.unwrap();
            delta -= 1;
            pos = i_close + "</component>".len();
        }
    }
    delta
}

pub(crate) fn write_edits<R: BufRead, W: Write>(
    reader: R,
    writer: &mut W,
    edits: &EditRequest,
    storage_cargo_patches: &HashMap<String, Vec<(String, u64)>>,
) -> Result<(), String> {
    use std::collections::HashSet;

    let inv_map: HashMap<String, u32> = edits
        .inventory.iter()
        .map(|e| (e.ware.clone(), e.amount))
        .collect();
    let bp_add: HashSet<&str> = edits.blueprints_add.iter().map(|s| s.as_str()).collect();
    let bp_remove: HashSet<&str> = edits.blueprints_remove.iter().map(|s| s.as_str()).collect();
    let research_unlock: HashSet<&str> = edits.research_unlock.iter().map(|s| s.as_str()).collect();
    let rep_map: HashMap<String, f64> = edits.reputation_edits.iter()
        .map(|e| (e.faction_id.clone(), e.relation))
        .collect();
    let npc_skill_map: HashMap<String, NpcSkillsEdit> = edits
        .npc_skills
        .iter()
        .map(|e| (e.code.clone(), e.clone()))
        .collect();
    let ship_name_map: HashMap<String, String> = edits
        .ship_names
        .iter()
        .map(|e| (e.code.clone(), e.name.clone()))
        .collect();
    let mut in_info              = false;
    let mut info_done            = false;
    let mut faction_player_seen  = false;
    let mut faction_account_done = false;
    let mut rep_player_faction      = false;
    let mut in_rep_relations        = false;
    let mut rep_other_faction: Option<String> = None;  // faction ID en cours si dans rep_map
    let mut in_other_faction_relations = false;
    let mut in_player_component  = false;
    let mut player_depth: u32    = 0;
    let mut in_player_inventory  = false;
    let mut in_blueprints             = false;
    let mut in_player_research_block  = false;
    let mut in_researchables          = false;
    let mut researchables_seen: HashSet<String> = HashSet::new();
    let mut stat_done            = false;
    let mut inv_seen: HashSet<String> = HashSet::new();

    let mut comp_depth: i32 = 0;
    let mut in_target_npc = false;
    let mut npc_start_depth: i32 = 0;
    let mut had_skills_line = false;
    let mut npc_edit_spec: Option<NpcSkillsEdit> = None;

    let mut storage_buf: Vec<String> = Vec::new();
    let mut storage_buf_id: String = String::new();
    let mut storage_buf_depth: i32 = 0;

    for line_result in reader.lines() {
        let mut line = line_result.map_err(|e| format!("Erreur lecture : {e}"))?;
        let trimmed = line.trim_start().to_string();
        let mut skip = false;

        // ── NPCs joueur : <traits><skills/></traits> ou ligne <skills/> seule (rempl. / insert) ─
        if !npc_skill_map.is_empty() {
            let depth_before = comp_depth;
            let dcomp = scan_component_depth_delta(&line);
            let depth_after = depth_before + dcomp;
            let t = trimmed.as_str();

            if in_target_npc && t.starts_with("<traits") && t.contains("<skills") {
                if let Some(ref spec) = npc_edit_spec {
                    let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                    line = npc_traits_skills_one_line(&indent, spec);
                    had_skills_line = true;
                }
            } else if in_target_npc && t.starts_with("<skills") {
                if let Some(ref spec) = npc_edit_spec {
                    let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                    line = npc_skills_xml_line(&indent, spec);
                    had_skills_line = true;
                }
            } else if in_target_npc && t.starts_with("</component>") && depth_before == npc_start_depth {
                if !had_skills_line {
                    if let Some(ref spec) = npc_edit_spec {
                        let base_indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                        let block_indent = format!("{}  ", base_indent);
                        let sl = npc_traits_skills_one_line(&block_indent, spec);
                        writeln!(writer, "{}", sl).map_err(|e| format!("Erreur écriture : {e}"))?;
                    }
                }
                in_target_npc = false;
                npc_edit_spec = None;
                had_skills_line = false;
            } else if line_opens_player_npc_component(&line) {
                if let Some(code) = extract_attr(&line, "code") {
                    if let Some(spec) = npc_skill_map.get(&code) {
                        in_target_npc = true;
                        npc_edit_spec = Some(spec.clone());
                        had_skills_line = false;
                        npc_start_depth = depth_after;
                    }
                }
            }
            comp_depth = depth_after;
        }

        // ── Bloc <info> ──────────────────────────────────────────────────────
        if !info_done {
            if trimmed.starts_with("<info") {
                in_info = true;
            } else if trimmed.starts_with("</info>") {
                in_info = false;
                info_done = true;
            } else if in_info {
                if trimmed.starts_with("<game ") {
                    line = replace_attr(&line, "modified", if edits.modified { "1" } else { "0" });
                } else if trimmed.starts_with("<player ") && trimmed.contains("money=") {
                    line = replace_attr(&line, "name", &edits.player_name);
                    line = replace_attr(&line, "money", &edits.money.to_string());
                }
            }
        }

        // ── Compte joueur dans <faction id="player"> ─────────────────────────
        if !faction_account_done {
            if line.contains("faction id=\"player\"") {
                faction_player_seen = true;
            } else if faction_player_seen && trimmed.starts_with("<account ") && !line.contains("own=") {
                line = replace_attr(&line, "amount", &edits.money.to_string());
                faction_account_done = true;
            } else if faction_player_seen && trimmed.starts_with("</faction>") {
                faction_player_seen = false;
            }
        }

        // ── Relations : côté joueur <faction id="player"><relations> ────────
        if !rep_map.is_empty() {
            if !rep_player_faction {
                if line.contains("faction id=\"player\"") {
                    rep_player_faction = true;
                }
            } else if !in_rep_relations {
                if trimmed.starts_with("<relations>") {
                    in_rep_relations = true;
                } else if trimmed.starts_with("</faction>") {
                    rep_player_faction = false;
                }
            } else {
                if trimmed.starts_with("</relations>") {
                    in_rep_relations = false;
                } else if trimmed.starts_with("<relation ") || trimmed.starts_with("<booster ") {
                    if let Some(faction_id) = extract_attr(&line, "faction") {
                        if let Some(&target_rel) = rep_map.get(&faction_id) {
                            line = replace_attr(&line, "relation", &format!("{}", target_rel));
                        }
                    }
                }
            }
        }

        // ── Relations : côté faction <faction id="X"><relations> ─────────────
        if !rep_map.is_empty() {
            if rep_other_faction.is_none() {
                if trimmed.starts_with("<faction ") && !line.contains("faction id=\"player\"") {
                    if let Some(fid) = extract_attr(&line, "id") {
                        if rep_map.contains_key(&fid) {
                            rep_other_faction = Some(fid);
                            in_other_faction_relations = false;
                        }
                    }
                }
            } else if let Some(ref fid) = rep_other_faction.clone() {
                if !in_other_faction_relations {
                    if trimmed.starts_with("<relations>") {
                        in_other_faction_relations = true;
                    } else if trimmed.starts_with("</faction>") {
                        rep_other_faction = None;
                    }
                } else {
                    if trimmed.starts_with("</relations>") {
                        in_other_faction_relations = false;
                    } else if trimmed.starts_with("<relation ") || trimmed.starts_with("<booster ") {
                        if let Some(other) = extract_attr(&line, "faction") {
                            if other == "player" {
                                if let Some(&target_rel) = rep_map.get(fid) {
                                    line = replace_attr(&line, "relation", &format!("{}", target_rel));
                                }
                            }
                        }
                    }
                }
            }
        }

        // ── Composant joueur ─────────────────────────────────────────────────
        if !in_player_component {
            if trimmed.starts_with("<component ") && line.contains("class=\"player\"") {
                in_player_component = true;
                player_depth = 1;
            }
        } else {
            if trimmed.starts_with("<component ") {
                player_depth += 1;
            } else if trimmed.starts_with("</component>") {
                player_depth -= 1;
                if player_depth == 0 {
                    in_player_component = false;
                    in_player_inventory = false;
                    in_blueprints = false;
                    in_player_research_block = false;
                }
            } else if trimmed.starts_with("<inventory>") && player_depth == 1 {
                in_player_inventory = true;
            } else if player_depth == 1 && trimmed == "<blueprints/>" {
                // Blueprints vides (self-closing) — on développe si ajouts demandés
                if !bp_add.is_empty() {
                    let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                    let bp_indent = format!("{}  ", indent);
                    writeln!(writer, "{}<blueprints>", indent).map_err(|e| format!("Erreur écriture : {e}"))?;
                    for ware in &bp_add {
                        writeln!(writer, "{}<blueprint ware=\"{}\"/>", bp_indent, ware).map_err(|e| format!("Erreur écriture : {e}"))?;
                    }
                    writeln!(writer, "{}</blueprints>", indent).map_err(|e| format!("Erreur écriture : {e}"))?;
                    skip = true;
                }
            } else if player_depth == 1 && trimmed.starts_with("<blueprints>") {
                in_blueprints = true;
            } else if in_blueprints && trimmed.starts_with("</blueprints>") {
                // Insère les nouveaux blueprints avant la fermeture
                if !bp_add.is_empty() {
                    let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                    let bp_indent = format!("{}  ", indent);
                    for ware in &bp_add {
                        writeln!(writer, "{}<blueprint ware=\"{}\"/>", bp_indent, ware).map_err(|e| format!("Erreur écriture : {e}"))?;
                    }
                }
                in_blueprints = false;
                // La ligne </blueprints> s'écrit normalement
            } else if in_blueprints && trimmed.starts_with("<blueprint ") {
                // Supprime les blueprints marqués à retirer
                if let Some(ware) = extract_attr(&line, "ware") {
                    if bp_remove.contains(ware.as_str()) {
                        skip = true;
                    }
                }
            } else if in_player_component && player_depth == 1 && trimmed == "<research>" {
                in_player_research_block = true;
            } else if in_player_component && player_depth == 1 && trimmed == "<research/>" {
                // Bloc vide — on développe si des unlocks sont demandés
                if !research_unlock.is_empty() {
                    let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                    let item_indent = format!("{}  ", indent);
                    writeln!(writer, "{}<research>", indent).map_err(|e| format!("Erreur écriture : {e}"))?;
                    for id in &research_unlock {
                        writeln!(writer, "{}<research ware=\"{}\" method=\"research\"/>", item_indent, id)
                            .map_err(|e| format!("Erreur écriture : {e}"))?;
                    }
                    writeln!(writer, "{}</research>", indent).map_err(|e| format!("Erreur écriture : {e}"))?;
                    skip = true;
                }
            } else if in_player_research_block && trimmed.starts_with("</research>") {
                // Injecter les nouvelles recherches avant la fermeture
                if !research_unlock.is_empty() {
                    let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                    let item_indent = format!("{}  ", indent);
                    for id in &research_unlock {
                        writeln!(writer, "{}<research ware=\"{}\" method=\"research\"/>", item_indent, id)
                            .map_err(|e| format!("Erreur écriture : {e}"))?;
                    }
                }
                in_player_research_block = false;
            } else if !research_unlock.is_empty() && trimmed.starts_with("<entries ") && trimmed.contains("type=\"researchables\"") {
                in_researchables = true;
            } else if in_researchables && trimmed.starts_with("<entry ") {
                if let Some(id) = extract_attr(&line, "id") {
                    researchables_seen.insert(id);
                }
            } else if in_researchables && trimmed.starts_with("</entries>") {
                // Injecter les entrées manquantes avant la fermeture
                let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                let item_indent = format!("{}  ", indent);
                for id in &research_unlock {
                    if !researchables_seen.contains(*id) {
                        writeln!(writer, "{}<entry id=\"{}\" read=\"0\"/>", item_indent, id)
                            .map_err(|e| format!("Erreur écriture : {e}"))?;
                    }
                }
                in_researchables = false;
            } else if trimmed.starts_with("</inventory>") && in_player_inventory {
                // Injecter les nouveaux items (pas encore vus dans le XML)
                let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
                let item_indent = format!("{}  ", indent);
                for (ware_id, &amount) in &inv_map {
                    if !inv_seen.contains(ware_id.as_str()) {
                        if amount > 0 {
                            writeln!(writer, "{}<ware ware=\"{}\" amount=\"{}\"/>", item_indent, ware_id, amount)
                                .map_err(|e| format!("Erreur écriture ware : {e}"))?;
                        }
                    }
                }
                in_player_inventory = false;
            } else if in_player_inventory && trimmed.starts_with("<ware ") {
                if let Some(ware_id) = extract_attr(&line, "ware") {
                    inv_seen.insert(ware_id.clone());
                    if let Some(&new_amount) = inv_map.get(&ware_id) {
                        line = set_ware_amount(&line, new_amount);
                    }
                }
            }
        }

        // ── Stat money_player ────────────────────────────────────────────────
        if !stat_done && line.contains("stat id=\"money_player\"") {
            line = replace_attr(&line, "value", &edits.money.to_string());
            stat_done = true;
        }

        // ── Noms de vaisseaux ────────────────────────────────────────────────
        if !ship_name_map.is_empty() {
            let hit = ship_name_map.keys().find(|code| {
                (line.contains(&format!("code=\"{}\"", code)) || line.contains(&format!("code='{}'", code)))
                    && (line.contains("class=\"ship_") || line.contains("class='ship_"))
            }).cloned();
            if let Some(code) = hit {
                let new_name = &ship_name_map[&code];
                if line.contains("name=\"") || line.contains("name='") {
                    line = replace_attr(&line, "name", new_name);
                } else {
                    let code_attr = format!("code=\"{}\"", code);
                    line = line.replacen(&code_attr, &format!("name=\"{}\" {}", new_name, code_attr), 1);
                }
            }
        }

        if !storage_cargo_patches.is_empty() {
            if !storage_buf.is_empty() {
                let delta = scan_component_depth_delta(&line);
                storage_buf_depth += delta;
                storage_buf.push(line.clone());
                skip = true;
                if storage_buf_depth <= 0 {
                    let joined = storage_buf.join("\n");
                    let wares = storage_cargo_patches.get(&storage_buf_id).map(|v| v.as_slice()).unwrap_or(&[]);
                    let rebuilt = rebuild_storage_component_block(&joined, wares)?;
                    writeln!(writer, "{}", rebuilt).map_err(|e| format!("Erreur écriture : {e}"))?;
                    storage_buf.clear();
                    storage_buf_id.clear();
                    storage_buf_depth = 0;
                }
            } else {
                let matched_id = storage_cargo_patches.keys().find(|id| {
                    let id_dq = format!("id=\"{}\"", id);
                    let id_sq = format!("id='{}'", id);
                    (line.contains(&id_dq) || line.contains(&id_sq))
                        && (line.contains("class=\"storage\"") || line.contains("class='storage'"))
                        && (line.contains("connection=\"space\"") || line.contains("connection='space'"))
                }).cloned();
                if let Some(slot_id) = matched_id {
                    let delta = scan_component_depth_delta(&line);
                    storage_buf_depth = delta;
                    storage_buf.push(line.clone());
                    storage_buf_id = slot_id;
                    skip = true;
                    if storage_buf_depth <= 0 {
                        let joined = storage_buf.join("\n");
                        let wares = storage_cargo_patches.get(&storage_buf_id).map(|v| v.as_slice()).unwrap_or(&[]);
                        let rebuilt = rebuild_storage_component_block(&joined, wares)?;
                        writeln!(writer, "{}", rebuilt).map_err(|e| format!("Erreur écriture : {e}"))?;
                        storage_buf.clear();
                        storage_buf_id.clear();
                        storage_buf_depth = 0;
                    }
                }
            }
        }

        if !skip {
            writeln!(writer, "{}", line).map_err(|e| format!("Erreur écriture : {e}"))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn apply_edits(app: tauri::AppHandle, path: String, edits: EditRequest) -> Result<(), String> {
    validate_save_path(&path)?;
    let is_gz = path.ends_with(".gz");
    let total = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    let storage_cargo_patches: HashMap<String, Vec<(String, u64)>> = if edits.station_cargo.is_empty() {
        HashMap::new()
    } else {
        let res_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("resource_dir indisponible : {e}"))?
            .join("resources");
        let mod_map = load_module_cargo_map_from_path(&res_dir.join("modules.json"))?;
        let ware_map = load_ware_cargo_map_from_path(&res_dir.join("wares.json"))?;
        build_storage_cargo_patches(&edits, &mod_map, &ware_map)?
    };

    // Backup — préservé tel quel si déjà existant (session initiale)
    let backup = format!("{}.bak", &path);
    if !Path::new(&backup).exists() {
        fs::copy(&path, &backup)
            .map_err(|e| format!("Impossible de créer le backup : {e}"))?;
    }

    // Écriture vers fichier temporaire (nettoyage automatique en cas d'erreur)
    let parent_dir = Path::new(&path)
        .parent()
        .ok_or_else(|| "Chemin sans répertoire parent".to_string())?;
    let mut tmp_file = tempfile::Builder::new()
        .suffix(".tmp")
        .tempfile_in(parent_dir)
        .map_err(|e| format!("Impossible de créer le fichier temporaire : {e}"))?;

    {
        let src = File::open(&path)
            .map_err(|e| format!("Impossible d'ouvrir le fichier : {e}"))?;
        let progress = ProgressReader::new(src, total, app.clone());

        if is_gz {
            let reader = BufReader::new(GzDecoder::new(BufReader::new(progress)));
            let mut encoder = GzEncoder::new(BufWriter::new(tmp_file.as_file_mut()), Compression::default());
            write_edits(reader, &mut encoder, &edits, &storage_cargo_patches)?;
            encoder
                .finish()
                .map_err(|e| format!("Erreur finalisation gz : {e}"))?;
        } else {
            let mut writer = BufWriter::new(tmp_file.as_file_mut());
            write_edits(BufReader::new(progress), &mut writer, &edits, &storage_cargo_patches)?;
            writer.flush().map_err(|e| format!("Erreur flush : {e}"))?;
        }
    }

    // Remplacement atomique
    tmp_file
        .persist(&path)
        .map_err(|e| format!("Impossible de remplacer le fichier : {}", e.error))?;

    app.emit("progress", json!({ "pct": 100 })).ok();
    Ok(())
}