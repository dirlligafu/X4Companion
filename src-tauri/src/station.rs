use crate::types::{EditRequest, ModuleCargoInfo, StationStorageSlotJson, WareAmountEdit, WareCargoInfo};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
pub(crate) fn load_module_cargo_map_from_path(json_path: &Path) -> Result<HashMap<String, ModuleCargoInfo>, String> {
    let content = fs::read_to_string(json_path)
        .map_err(|e| format!("Lecture modules.json impossible : {e}"))?;
    let items: Vec<Value> = serde_json::from_str(&content).map_err(|e| format!("JSON modules invalide : {e}"))?;
    let map: HashMap<String, ModuleCargoInfo> = items
        .iter()
        .filter_map(|item| {
            let macro_id = item["macroID"].as_str()?;
            let key = macro_id.strip_suffix("_macro").unwrap_or(macro_id).to_string();
            let capacity = item["cargoCapacity"].as_u64().unwrap_or(0);
            if capacity == 0 {
                return None;
            }
            let cargo_type_str = item["cargoType"].as_str().unwrap_or("");
            let types: Vec<String> = cargo_type_str.split_whitespace().map(String::from).collect();
            if types.is_empty() {
                return None;
            }
            Some((key, ModuleCargoInfo { capacity, types }))
        })
        .collect();
    Ok(map)
}

pub(crate) fn load_ware_cargo_map_from_path(json_path: &Path) -> Result<HashMap<String, WareCargoInfo>, String> {
    let content = fs::read_to_string(json_path)
        .map_err(|e| format!("Lecture wares.json impossible : {e}"))?;
    let items: Vec<Value> = serde_json::from_str(&content).map_err(|e| format!("JSON wares invalide : {e}"))?;
    let map: HashMap<String, WareCargoInfo> = items
        .iter()
        .filter_map(|item| {
            let id = item["wareID"].as_str()?.to_string();
            let volume = item["volume"].as_u64()? as u32;
            let transport = item["transport"].as_str()?.to_string();
            Some((id, WareCargoInfo { volume, transport }))
        })
        .collect();
    Ok(map)
}

fn merge_station_wanted(raw: &[WareAmountEdit]) -> HashMap<String, u64> {
    let mut m = HashMap::new();
    for w in raw {
        *m.entry(w.ware.clone()).or_insert(0) += w.amount;
    }
    m
}

fn slot_capacity_by_transport(
    module_index: &HashMap<String, ModuleCargoInfo>,
    macro_id: &str,
) -> Option<HashMap<String, u64>> {
    let info = module_index.get(macro_id)?;
    let mut caps = HashMap::new();
    for t in &info.types {
        *caps.entry(t.clone()).or_insert(0) += info.capacity;
    }
    Some(caps)
}

/// Remplit les silos `connection=space` connus du catalogue (`space_storage_index` = position dans la station).
fn ventilate_station_cargo(
    wanted: &[WareAmountEdit],
    slots: &[StationStorageSlotJson],
    module_index: &HashMap<String, ModuleCargoInfo>,
    ware_index: &HashMap<String, WareCargoInfo>,
) -> Result<HashMap<String, Vec<(String, u64)>>, String> {
    type SlotState = (String, HashMap<String, u64>, HashMap<String, u64>);
    let mut space_slots: Vec<SlotState> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();
    for sl in slots {
        if sl.connection != "space" { continue; }
        let Some(caps) = slot_capacity_by_transport(module_index, &sl.macro_id) else { continue; };
        if !seen_ids.insert(sl.id.clone()) {
            return Err(format!("station_storage_layout : id {} en double", sl.id));
        }
        space_slots.push((sl.id.clone(), caps, HashMap::new()));
    }
    if space_slots.is_empty() {
        return Err("Aucun module de stockage space connu dans le catalogue (modules.json).".to_string());
    }

    let mut remaining = merge_station_wanted(wanted);
    remaining.retain(|w, _| ware_index.contains_key(w));

    let mut w_order: Vec<String> = remaining.keys().cloned().collect();
    w_order.sort_by(|a, b| {
        let va = remaining[a] * ware_index.get(a).map(|i| i.volume as u64).unwrap_or(0);
        let vb = remaining[b] * ware_index.get(b).map(|i| i.volume as u64).unwrap_or(0);
        vb.cmp(&va)
    });

    let mut out: HashMap<String, Vec<(String, u64)>> = HashMap::new();
    for (id, _, _) in &space_slots {
        out.insert(id.clone(), Vec::new());
    }

    for ware in w_order {
        loop {
            let amt = *remaining.get(&ware).unwrap_or(&0);
            if amt == 0 { break; }
            let w_inf = match ware_index.get(&ware) { Some(x) => x, None => break };
            let vol = w_inf.volume as u64;
            if vol == 0 { break; }
            let t = w_inf.transport.clone();
            let mut placed = false;
            for slot in &mut space_slots {
                let cap_t = *slot.1.get(&t).unwrap_or(&0);
                if cap_t == 0 { continue; }
                let u = *slot.2.get(&t).unwrap_or(&0);
                // marge de 2 unités de volume pour éviter tout overflow de capacité en jeu
                let room = cap_t.saturating_sub(u).saturating_sub(2);
                if room < vol { continue; }
                let add = amt.min(room / vol);
                if add == 0 { continue; }
                let id = slot.0.clone();
                let vec = out.get_mut(&id).expect("id pré-rempli");
                if let Some(x) = vec.iter_mut().find(|(w, _)| w == &ware) {
                    x.1 += add;
                } else {
                    vec.push((ware.clone(), add));
                }
                *slot.2.entry(t.clone()).or_insert(0) += add * vol;
                *remaining.get_mut(&ware).unwrap() -= add;
                placed = true;
                break;
            }
            if !placed { break; }
        }
    }

    Ok(out)
}

pub(crate) fn build_storage_cargo_patches(
    edits: &EditRequest,
    module_index: &HashMap<String, ModuleCargoInfo>,
    ware_index: &HashMap<String, WareCargoInfo>,
) -> Result<HashMap<String, Vec<(String, u64)>>, String> {
    let mut combined: HashMap<String, Vec<(String, u64)>> = HashMap::new();
    for sc in &edits.station_cargo {
        let slots = edits
            .station_storage_layout
            .iter()
            .find(|e| e.station_code == sc.station_code)
            .map(|e| e.slots.as_slice())
            .ok_or_else(|| {
                format!("station_storage_layout manquant pour la station code={}", sc.station_code)
            })?;
        let part = ventilate_station_cargo(&sc.wares, slots, module_index, ware_index)?;
        combined.extend(part);
    }
    Ok(combined)
}

/// Retire `<cargo>…</cargo>` et `<cargo/>` d’un fragment interne au module storage.
fn strip_cargo_sections(inner: &str) -> String {
    let mut r = String::new();
    let mut rest = inner;
    while !rest.is_empty() {
        if let Some(pos) = rest.find("<cargo") {
            r.push_str(&rest[..pos]);
            rest = &rest[pos..];
            if rest.starts_with("<cargo/>") {
                if let Some(i) = rest.find('>') {
                    rest = &rest[i + 1..];
                    continue;
                }
            }
            if rest.starts_with("<cargo />") {
                if let Some(i) = rest.find('>') {
                    rest = &rest[i + 1..];
                    continue;
                }
            }
            if rest.starts_with("<cargo>") {
                if let Some(end) = rest.find("</cargo>") {
                    rest = &rest[end + "</cargo>".len()..];
                    continue;
                }
            }
            r.push('<');
            rest = &rest[1..];
        } else {
            r.push_str(rest);
            break;
        }
    }
    r
}

fn format_compact_cargo(wares: &[(String, u64)]) -> String {
    if wares.is_empty() {
        return "<cargo/>".to_string();
    }
    let mut s = String::from("<cargo>");
    for (w, a) in wares {
        use std::fmt::Write;
        let _ = write!(&mut s, r#"<ware ware="{}" amount="{}"/>"#, w, a);
    }
    s.push_str("</cargo>");
    s
}

fn storage_open_tag_is_valid(open_tag: &str) -> bool {
    open_tag.contains("class=\"storage\"")
        || open_tag.contains("class='storage'")
}

pub(crate) fn rebuild_storage_component_block(old: &str, wares: &[(String, u64)]) -> Result<String, String> {
    let gt = old.find('>').ok_or("storage: balise ouvrante invalide")?;
    let open_tag = &old[..=gt];
    if !storage_open_tag_is_valid(open_tag) {
        return Err("storage: class inattendu".into());
    }
    let trimmed = old.trim_end();
    // Module storage sans enfants : `<component class="storage" …/>`
    if trimmed.ends_with("/>") {
        let head = trimmed[..trimmed.len() - 2].trim_end();
        let mut opening = head.to_string();
        opening.push('>');
        let cargo = format_compact_cargo(wares);
        return Ok(format!("{}{}</component>", opening, cargo));
    }
    let close_pos = old.rfind("</component>").ok_or("storage: </component> manquant")?;
    let inner_raw = &old[gt + 1..close_pos];
    let stripped = strip_cargo_sections(inner_raw);
    let cargo = format_compact_cargo(wares);
    // Le cargo doit précéder <connections> — le jeu l'ignore s'il est après
    if let Some(conn_pos) = stripped.find("<connections") {
        let before = stripped[..conn_pos].trim_end();
        let after = &stripped[conn_pos..];
        Ok(format!("{}{}{}{}</component>", open_tag, before, cargo, after))
    } else {
        let inner = stripped.trim_end();
        Ok(format!("{}{}{}</component>", open_tag, inner, cargo))
    }
}