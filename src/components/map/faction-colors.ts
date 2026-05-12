// True faction colors extracted from .\libraries\colors.xml (base game only).
// Format: true game HEX  // approx color used before | game ref name

export const FACTION_COLORS: Record<string, string> = {
  // --- Major factions ---
  argon:             "#0069B3", // was #3b82f6 (blue)         | azure_dark_moderate_glow
  antigone:          "#0095FF", // was #06b6d4 (cyan)         | azure_weak_glow
  hatikvah:          "#00F9FF", // was #84cc16 (lime)         | cyan_weak_glow
  paranid:           "#B300B3", // was #a855f7 (purple)       | magenta_dark_weak_glow
  holyorder:         "#FF99FF", // was #7c3aed (violet)       | magenta_very_bright_weak_glow
  holyorderfanatic:  "#660000", //                            | red_very_dark_moderate_glow
  teladi:            "#B3B300", // was #22c55e (green)        | yellow_dark_weak_glow
  ministry:          "#006600", // was #16a34a (dark green)   | green_very_dark_moderate_glow
  split:             "#B36100", // was #ef4444 (red)          | orange_dark_weak_glow
  freesplit:         "#FF8B00", // was #f97316 (orange)       | orange_weak_glow
  fallensplit:       "#FF9999", //                            | red_very_bright_moderate_glow
  terran:            "#99D5FF", // was #64748b (slate)        | azure_very_bright_weak_glow
  pioneers:          "#00AFB3", // was #94a3b8 (light slate)  | cyan_dark_weak_glow
  xenon:             "#B30000", // was #dc2626 (dark red)     | red_dark_moderate_glow
  khaak:             "#FF00FF", // was #92400e (brown)        | magenta_moderate_glow
  boron:             "#4DB5FF", // was #0ea5e9 (sky blue)     | azure_bright_weak_glow

  // --- Minor / neutral factions ---
  kaori:             "#FFB966", // was #f59e0b (amber)        | orange_bright_moderate_glow
  loanshark:         "#B38600", // was #d97706 (dark amber)   | amber_dark_moderate_glow
  scavenger:         "#003C66", // was #78716c (stone)        | azure_very_dark_moderate_glow
  scaleplate:        "#666600", // was #a16207 (yellow-brown) | yellow_very_dark_moderate_glow
  yaki:              "#FF4D4D", //                            | red_bright_moderate_glow
  buccaneers:        "#006466", //                            | cyan_very_dark_moderate_glow
  criminal:          "#B30000", //                            | red_dark_moderate_glow
  smuggler:          "#B30000", //                            | red_dark_moderate_glow
  alliance:          "#660066", //                            | magenta_very_dark_moderate_glow
  court:             "#FFBF00", //                            | amber_moderate_glow
  trinity:           "#FFCCFF", //                            | magenta_extra_bright_moderate_glow
  visitor:           "#FFFF00", //                            | yellow_moderate_glow
  player:            "#4DFF4D", //                            | green_bright_weak_glow

  // --- Generic ---
  civilian:          "#C0C0C0", // was #9ca3af (gray)         | grey_192_weak_glow
  ownerless:         "#C0C0C0", // was #374151 (dark gray)    | grey_192_weak_glow

  // --- À identifier (placeholders) ---
  atf:               "#888888",
  cabal:             "#888888",
  provinces:         "#888888",
  rhak:              "#888888",
  tempest:           "#888888",
  terraformer:       "#888888",
  usc:               "#888888",
  paranid_timelines: "#888888",
};

export const FACTION_LOGOS: Record<string, string> = {
  argon:      "/faction_logos/Faction_argon.png",
  antigone:   "/faction_logos/Faction_antigone.png",
  hatikvah:   "/faction_logos/Faction_hatikvah.png",
  paranid:    "/faction_logos/Faction_paranid.png",
  holyorder:  "/faction_logos/Faction_holyorder.png",
  teladi:     "/faction_logos/Faction_teladi.png",
  ministry:   "/faction_logos/Faction_ministry.png",
  xenon:      "/faction_logos/Faction_xenon.png",
  khaak:      "/faction_logos/Faction_khaak.png",
  scaleplate: "/faction_logos/Faction_scaleplate.png",  
  boron:      "/faction_logos/Faction_boron.png",


  alliance:   "/faction_logos/Faction_alliance.png",
  terran:     "/faction_logos/Faction_terran.png",
  buccaneers: "/faction_logos/Faction_buccaneers.png",
  civilian:   "/faction_logos/Faction_civilian.png",
  criminal:   "/faction_logos/Faction_criminal.png",
  ownerless:  "/faction_logos/Faction_ownerless.png",
  player:     "/faction_logos/Faction_player.png",
  tempest:    "/faction_logos/Faction_tempest.png",
  trinity:    "/faction_logos/Faction_trinity.png",
  visitor:    "/faction_logos/Faction_visitor.png",
  cabal:      "/faction_logos/Faction_cabal.png",
  court:      "/faction_logos/Faction_court.png",
  fallensplit: "/faction_logos/Faction_fallensplit.png",
  freesplit:   "/faction_logos/Faction_freesplit.png",
  loanshark:   "/faction_logos/Faction_loanshark.png",
  provinces:   "/faction_logos/Faction_provinces.png",
  rhak:        "/faction_logos/Faction_rhak.png",
  scavenger:   "/faction_logos/Faction_scavenger.png",
  split:       "/faction_logos/Faction_split.png",
  yaki:        "/faction_logos/Faction_yaki.png",
  pioneers:    "/faction_logos/Faction_pioneers.png",
  atf:         "/faction_logos/Faction_atf.png",
  kaori:       "/faction_logos/Faction_kaori.png",
  paranid_timelines: "/faction_logos/Faction_paranid_timelines.png",
  terraformer: "/faction_logos/Faction_terraformer.png",
  usc:         "/faction_logos/Faction_usc.png",
};

export const FACTION_LABELS: Record<string, string> = {
  argon:            "Argon Federation",
  antigone:         "Antigone Republic",
  hatikvah:         "Hatikvah's Choice",
  paranid:          "Godrealm of the Paranid",
  holyorder:        "Holy Order of the Pontifex",
  holyorderfanatic: "Holy Order Fanatics",
  teladi:           "Teladi Company",
  ministry:         "Ministry of Finance",
  split:            "Split Patriarchy",
  freesplit:        "Free Families",
  fallensplit:      "Fallen Families",
  terran:           "Terran Protectorate",
  pioneers:         "Segaris Pioneers",
  xenon:            "Xenon",
  khaak:            "Kha'ak",
  boron:            "Boron Kingdom",
  kaori:            "Kaori",
  loanshark:        "Loan Sharks",
  scavenger:        "Scavengers",
  scaleplate:       "Scaleplate Pirates",
  yaki:             "Yaki",
  buccaneers:       "Buccaneers",
  criminal:         "Criminals",
  smuggler:         "Smugglers",
  alliance:         "Alliance of the Word",
  court:            "Court of Curbs",
  trinity:          "Trinity",
  visitor:          "Visitors",
  player:           "Player",
  civilian:         "Civilian",
  ownerless:        "Ownerless",

  // --- À identifier ---
  atf:               "",
  cabal:             "",
  provinces:         "",
  rhak:              "",
  tempest:           "",
  terraformer:       "",
  usc:               "",
  paranid_timelines: "",
};
