<?php
/* =========================================================================
   STIKE BIKE SHOP: datos de la pestaña «Analitica» del panel (solo lectura).

     GET  api/analytics.php?view=status                      configuracion guardada (sin secretos)
     GET  api/analytics.php?view=summary&range=28d           KPIs con el periodo anterior, serie diaria, eventos clave, embudo
     GET  api/analytics.php?view=acquisition&range=28d       canales, fuentes, paginas de entrada
     GET  api/analytics.php?view=pages&range=28d             paginas mas vistas, paginas rotas, lo que buscan en la tienda
     GET  api/analytics.php?view=products&range=28d          productos, categorias y marcas (vistas, carrito, compras, ingresos)
     GET  api/analytics.php?view=audience&range=28d          dispositivos, ciudades, nuevos y recurrentes, mapa de horas
     GET  api/analytics.php?view=whatsapp&range=28d          clics a WhatsApp por lugar, pagina, dispositivo, fuente y hora
     GET  api/analytics.php?view=realtime                    usuarios activos ahora (ultimos 30 minutos)
     GET  api/analytics.php?view=search&range=28d            Search Console: clics, impresiones, CTR, posicion, consultas, paginas
     GET  api/analytics.php?view=sitemaps                    estado de los sitemaps en Search Console
     GET  api/analytics.php?view=firstparty&range=28d        el contador propio (respaldo de GA4)
     POST api/analytics.php {view: "test"}                   comprueba toda la conexion y dice que falta (dueño y desarrollador)
     POST api/analytics.php {view: "sitemap_submit"}         envia sitemap.xml a Search Console (dueño y desarrollador)

   Solo roles con acceso a las finanzas (los datos incluyen ingresos). Los resultados buenos de Google se guardan unos minutos
   (&refresh=1 los pide de nuevo; con tope de uso). Un error de Google NO es un error de este endpoint: se contesta 200 con
   {ok: false, code, detail} y la frase que dice que hacer; asi la pestaña muestra una tarjeta clara y las demas secciones siguen.
   ========================================================================= */
require __DIR__ . "/_admin.php";
require_once __DIR__ . "/_google.php";

const STIKE_AN_KEY_EVENTS = ["whatsapp_click", "view_item", "add_to_cart", "begin_checkout", "purchase", "generate_lead", "contact_click", "search", "view_item_list", "select_item", "view_cart", "payment_failed", "checkout_error", "share", "page_not_found"];
const STIKE_AN_TTL = 600;          // GA4: 10 minutos
const STIKE_AN_TTL_RT = 30;        // tiempo real: 30 segundos
const STIKE_AN_TTL_GSC = 3600;     // Search Console: 1 hora (sus datos se actualizan una vez al dia)

function stike_an_d8($v) { return preg_match('/^(\d{4})(\d{2})(\d{2})$/', (string)$v, $m) ? "$m[1]-$m[2]-$m[3]" : (string)$v; }
function stike_an_n($row, $k) { return isset($row[$k]) ? (float)$row[$k] : 0.0; }
function stike_an_rows_by($rows, $dim) { $o = []; foreach ($rows as $r) $o[(string)($r[$dim] ?? "")][] = $r; return $o; }
function stike_an_range_dates($r) { return [["startDate" => $r["from"], "endDate" => $r["to"], "name" => "cur"], ["startDate" => $r["prevFrom"], "endDate" => $r["prevTo"], "name" => "prev"]]; }
function stike_an_cur($r) { return [["startDate" => $r["from"], "endDate" => $r["to"], "name" => "cur"]]; }
function stike_an_prev($r) { return [["startDate" => $r["prevFrom"], "endDate" => $r["prevTo"], "name" => "prev"]]; }
/* [{dim => valor, metricas...}] -> los primeros $n por $metric (mayor primero), con nombres cortos. */
function stike_an_top($rows, $metric, $n) { usort($rows, fn($a, $b) => ($b[$metric] ?? 0) <=> ($a[$metric] ?? 0)); return array_slice($rows, 0, $n); }

/* Hace cada vista con el cache en disco. Los errores de Google se devuelven tal cual (ok:false) y no se guardan. */
function stike_an_view($name, $range, $refresh, $ttl, $fn) {
  $key = $name . "|" . (stike_ga4_property() ?: "") . "|" . (stike_gsc_site() ?: "") . "|" . ($range["from"] ?? "") . "|" . ($range["to"] ?? "") . "|" . (stike_g_sa()["email"] ?? "");
  $d = stike_g_cached($key, $ttl, $fn, $refresh);
  if (is_array($d) && isset($d["ok"]) && $d["ok"] === false) $d["setup"] = (strpos((string)($d["code"] ?? ""), "gsc") === 0) ? "gsc" : "ga4";
  return $d;
}

/* ============================================ estado ============================================ */
function stike_an_status() {
  $file = __DIR__ . "/../data/analytics.json";
  $pub = is_file($file) ? json_decode((string)@file_get_contents($file), true) : [];
  if (!is_array($pub)) $pub = [];
  $sa = stike_g_sa();
  $src = stike_config_sources("GOOGLE_SA_JSON");
  $fp = stike_fp_summary(stike_fp_when(time() - 29 * 86400)[0], stike_fp_when()[0]);
  return ["ok" => true,
    "site" => ["measurementId" => (string)($pub["ga4MeasurementId"] ?? ""), "consentMode" => (($pub["consentMode"] ?? "opt_out") === "opt_in") ? "opt_in" : "opt_out", "firstParty" => ($pub["firstParty"] ?? true) !== false, "gscVerification" => (string)($pub["gscVerification"] ?? "")],
    "ga4" => ["propertyId" => stike_ga4_property()],
    "gsc" => ["site" => stike_gsc_site()],
    "google" => ["serviceAccount" => $sa ? ["email" => $sa["email"], "project" => $sa["project"]] : null, "source" => $sa ? (!empty($src["panel"]) ? "panel" : "servidor") : null, "openssl" => function_exists("openssl_sign")],
    "firstParty" => ["first" => $fp["first"], "events30d" => array_sum(array_map(fn($e) => $e["n"], $fp["ev"]))],
  ];
}

/* ============================================ GA4: resumen ============================================ */
function stike_an_summary($r) {
  $mets = ["activeUsers", "newUsers", "sessions", "engagedSessions", "averageSessionDuration", "screenPageViews", "ecommercePurchases", "purchaseRevenue", "addToCarts", "checkouts"];
  $b = stike_ga4_batch([
    stike_ga4_rep([], $mets, stike_an_range_dates($r)),
    stike_ga4_rep(["eventName"], ["eventCount"], stike_an_range_dates($r), ["event" => STIKE_AN_KEY_EVENTS, "limit" => 60]),
    stike_ga4_rep(["date"], ["sessions", "activeUsers", "ecommercePurchases", "purchaseRevenue", "addToCarts"], stike_an_cur($r), ["order" => stike_ga4_order_dim("date"), "limit" => 400]),
    stike_ga4_rep(["date"], ["eventCount"], stike_an_cur($r), ["event" => ["whatsapp_click"], "order" => stike_ga4_order_dim("date"), "limit" => 400]),
    stike_ga4_rep(["date"], ["sessions"], stike_an_prev($r), ["order" => stike_ga4_order_dim("date"), "limit" => 400]),
  ]);
  if (empty($b["ok"])) return $b;
  [$kpiRows, $evRows, $serRows, $waRows, $prevRows] = $b["reports"] + [[], [], [], [], []];
  $short = ["activeUsers" => "users", "newUsers" => "newUsers", "sessions" => "sessions", "engagedSessions" => "engaged", "averageSessionDuration" => "avgDuration", "screenPageViews" => "pageViews", "ecommercePurchases" => "purchases", "purchaseRevenue" => "revenue", "addToCarts" => "addToCarts", "checkouts" => "checkouts"];
  $kpis = [];
  foreach ($short as $m => $s) $kpis[$s] = ["cur" => 0, "prev" => 0];
  foreach ($kpiRows as $row) { $rg = $row["dateRange"] ?? "cur"; foreach ($short as $m => $s) $kpis[$s][$rg === "prev" ? "prev" : "cur"] = stike_an_n($row, $m); }
  $events = [];
  foreach ($evRows as $row) { $n = (string)($row["eventName"] ?? ""); if ($n === "") continue; $events[$n][($row["dateRange"] ?? "cur") === "prev" ? "prev" : "cur"] = stike_an_n($row, "eventCount"); }
  foreach ($events as $n => $v) $events[$n] += ["cur" => 0, "prev" => 0];
  $wa = []; foreach ($waRows as $row) $wa[stike_an_d8($row["date"] ?? "")] = stike_an_n($row, "eventCount");
  $series = [];
  foreach ($serRows as $row) { $d = stike_an_d8($row["date"] ?? ""); $series[] = ["date" => $d, "sessions" => stike_an_n($row, "sessions"), "users" => stike_an_n($row, "activeUsers"), "purchases" => stike_an_n($row, "ecommercePurchases"), "revenue" => stike_an_n($row, "purchaseRevenue"), "addToCarts" => stike_an_n($row, "addToCarts"), "whatsapp" => $wa[$d] ?? 0]; }
  $prevSeries = array_map(fn($row) => ["date" => stike_an_d8($row["date"] ?? ""), "sessions" => stike_an_n($row, "sessions")], $prevRows);
  $ev = fn($n) => $events[$n]["cur"] ?? 0;
  return ["ok" => true, "range" => $r, "kpis" => $kpis, "events" => $events, "series" => $series, "prevSeries" => $prevSeries,
          "funnel" => ["sessions" => $kpis["sessions"]["cur"], "viewItem" => $ev("view_item"), "addToCart" => $ev("add_to_cart"), "beginCheckout" => $ev("begin_checkout"), "purchase" => $ev("purchase"), "whatsapp" => $ev("whatsapp_click")]];
}

/* ============================================ GA4: adquisicion ============================================ */
function stike_an_acquisition($r) {
  $b = stike_ga4_batch([
    stike_ga4_rep(["sessionDefaultChannelGroup"], ["sessions", "activeUsers", "engagedSessions", "ecommercePurchases", "purchaseRevenue"], stike_an_cur($r), ["order" => stike_ga4_order_metric("sessions"), "limit" => 12]),
    stike_ga4_rep(["sessionDefaultChannelGroup"], ["eventCount"], stike_an_cur($r), ["event" => ["whatsapp_click"], "limit" => 12]),
    stike_ga4_rep(["sessionSourceMedium"], ["sessions", "ecommercePurchases", "purchaseRevenue"], stike_an_cur($r), ["order" => stike_ga4_order_metric("sessions"), "limit" => 12]),
    stike_ga4_rep(["landingPage"], ["sessions", "engagedSessions", "ecommercePurchases"], stike_an_cur($r), ["order" => stike_ga4_order_metric("sessions"), "limit" => 12]),
  ]);
  if (empty($b["ok"])) return $b;
  [$ch, $chWa, $src, $land] = $b["reports"] + [[], [], [], []];
  $wa = []; foreach ($chWa as $row) $wa[(string)($row["sessionDefaultChannelGroup"] ?? "")] = stike_an_n($row, "eventCount");
  return ["ok" => true, "range" => $r,
    "channels" => array_map(fn($x) => ["name" => (string)$x["sessionDefaultChannelGroup"], "sessions" => stike_an_n($x, "sessions"), "users" => stike_an_n($x, "activeUsers"), "engaged" => stike_an_n($x, "engagedSessions"), "purchases" => stike_an_n($x, "ecommercePurchases"), "revenue" => stike_an_n($x, "purchaseRevenue"), "whatsapp" => $wa[(string)$x["sessionDefaultChannelGroup"]] ?? 0], $ch),
    "sources" => array_map(fn($x) => ["name" => (string)$x["sessionSourceMedium"], "sessions" => stike_an_n($x, "sessions"), "purchases" => stike_an_n($x, "ecommercePurchases"), "revenue" => stike_an_n($x, "purchaseRevenue")], $src),
    "landing" => array_map(fn($x) => ["path" => (string)$x["landingPage"], "sessions" => stike_an_n($x, "sessions"), "engaged" => stike_an_n($x, "engagedSessions"), "purchases" => stike_an_n($x, "ecommercePurchases")], $land)];
}

/* ============================================ GA4: paginas ============================================ */
function stike_an_pages($r) {
  $b = stike_ga4_batch([
    stike_ga4_rep(["pagePath"], ["screenPageViews", "activeUsers", "userEngagementDuration"], stike_an_cur($r), ["order" => stike_ga4_order_metric("screenPageViews"), "limit" => 20]),
    stike_ga4_rep(["pagePath"], ["eventCount"], stike_an_cur($r), ["event" => ["whatsapp_click"], "order" => stike_ga4_order_metric("eventCount"), "limit" => 15]),
    stike_ga4_rep(["pagePath"], ["eventCount"], stike_an_cur($r), ["event" => ["page_not_found"], "order" => stike_ga4_order_metric("eventCount"), "limit" => 10]),
    stike_ga4_rep(["searchTerm"], ["eventCount"], stike_an_cur($r), ["event" => ["search"], "order" => stike_ga4_order_metric("eventCount"), "limit" => 20]),
  ]);
  if (empty($b["ok"])) return $b;
  [$pg, $wa, $nf, $sr] = $b["reports"] + [[], [], [], []];
  return ["ok" => true, "range" => $r,
    "pages" => array_map(fn($x) => ["path" => (string)$x["pagePath"], "views" => stike_an_n($x, "screenPageViews"), "users" => stike_an_n($x, "activeUsers"), "avgSeconds" => stike_an_n($x, "activeUsers") > 0 ? stike_an_n($x, "userEngagementDuration") / stike_an_n($x, "activeUsers") : 0], $pg),
    "whatsappPages" => array_map(fn($x) => ["path" => (string)$x["pagePath"], "clicks" => stike_an_n($x, "eventCount")], $wa),
    "notFound" => array_map(fn($x) => ["path" => (string)$x["pagePath"], "views" => stike_an_n($x, "eventCount")], $nf),
    "searches" => array_values(array_filter(array_map(fn($x) => ["term" => (string)$x["searchTerm"], "count" => stike_an_n($x, "eventCount")], $sr), fn($x) => $x["term"] !== "" && $x["term"] !== "(not set)"))];
}

/* ============================================ GA4: productos ============================================ */
function stike_an_products($r) {
  $mets = ["itemsViewed", "itemsAddedToCart", "itemsPurchased", "itemRevenue"];
  $b = stike_ga4_batch([
    stike_ga4_rep(["itemName"], $mets, stike_an_cur($r), ["order" => stike_ga4_order_metric("itemsViewed"), "limit" => 30]),
    stike_ga4_rep(["itemCategory"], $mets, stike_an_cur($r), ["order" => stike_ga4_order_metric("itemsViewed"), "limit" => 12]),
    stike_ga4_rep(["itemBrand"], $mets, stike_an_cur($r), ["order" => stike_ga4_order_metric("itemsViewed"), "limit" => 12]),
  ]);
  if (empty($b["ok"])) return $b;
  $map = fn($rows, $dim) => array_values(array_filter(array_map(fn($x) => ["name" => (string)$x[$dim], "views" => stike_an_n($x, "itemsViewed"), "addToCart" => stike_an_n($x, "itemsAddedToCart"), "purchased" => stike_an_n($x, "itemsPurchased"), "revenue" => stike_an_n($x, "itemRevenue")], $rows), fn($x) => $x["name"] !== "" && $x["name"] !== "(not set)"));
  return ["ok" => true, "range" => $r, "products" => $map($b["reports"][0] ?? [], "itemName"), "categories" => $map($b["reports"][1] ?? [], "itemCategory"), "brands" => $map($b["reports"][2] ?? [], "itemBrand")];
}

/* ============================================ GA4: audiencia ============================================ */
function stike_an_audience($r) {
  $b = stike_ga4_batch([
    stike_ga4_rep(["deviceCategory"], ["sessions", "activeUsers", "ecommercePurchases"], stike_an_cur($r), ["order" => stike_ga4_order_metric("sessions"), "limit" => 6]),
    stike_ga4_rep(["city"], ["sessions", "activeUsers"], stike_an_cur($r), ["order" => stike_ga4_order_metric("sessions"), "limit" => 12]),
    stike_ga4_rep(["newVsReturning"], ["sessions", "activeUsers"], stike_an_cur($r), ["limit" => 4]),
    stike_ga4_rep(["dayOfWeek", "hour"], ["sessions"], stike_an_cur($r), ["limit" => 200]),
    stike_ga4_rep(["dayOfWeek", "hour"], ["eventCount"], stike_an_cur($r), ["event" => ["whatsapp_click"], "limit" => 200]),
  ]);
  if (empty($b["ok"])) return $b;
  [$dev, $city, $nvr, $hs, $hw] = $b["reports"] + [[], [], [], [], []];
  $heat = fn($rows, $m) => array_map(fn($x) => ["dow" => (int)$x["dayOfWeek"], "hour" => (int)$x["hour"], "v" => stike_an_n($x, $m)], $rows);
  return ["ok" => true, "range" => $r,
    "devices" => array_map(fn($x) => ["name" => (string)$x["deviceCategory"], "sessions" => stike_an_n($x, "sessions"), "users" => stike_an_n($x, "activeUsers"), "purchases" => stike_an_n($x, "ecommercePurchases")], $dev),
    "cities" => array_values(array_filter(array_map(fn($x) => ["name" => (string)$x["city"], "sessions" => stike_an_n($x, "sessions"), "users" => stike_an_n($x, "activeUsers")], $city), fn($x) => $x["name"] !== "" && $x["name"] !== "(not set)")),
    "newVsReturning" => array_map(fn($x) => ["name" => (string)$x["newVsReturning"], "sessions" => stike_an_n($x, "sessions"), "users" => stike_an_n($x, "activeUsers")], $nvr),
    "heatSessions" => $heat($hs, "sessions"), "heatWhatsapp" => $heat($hw, "eventCount")];
}

/* ============================================ GA4: WhatsApp ============================================ */
function stike_an_whatsapp($r) {
  $b = stike_ga4_batch([
    stike_ga4_rep(["deviceCategory"], ["eventCount"], stike_an_cur($r), ["event" => ["whatsapp_click"], "limit" => 6]),
    stike_ga4_rep(["sessionSourceMedium"], ["eventCount"], stike_an_cur($r), ["event" => ["whatsapp_click"], "order" => stike_ga4_order_metric("eventCount"), "limit" => 10]),
    stike_ga4_rep([], ["eventCount"], stike_an_range_dates($r), ["event" => ["whatsapp_click"]]),
  ]);
  if (empty($b["ok"])) return $b;
  [$dev, $src, $tot] = $b["reports"] + [[], [], []];
  $total = ["cur" => 0, "prev" => 0]; foreach ($tot as $row) $total[($row["dateRange"] ?? "cur") === "prev" ? "prev" : "cur"] = stike_an_n($row, "eventCount");
  // «lugar» y «tipo de pagina» son dimensiones personalizadas: si todavia no estan registradas en GA4 se avisa (no es un error)
  $custom = ["location" => ["customEvent:link_location", "link_location"], "pageType" => ["customEvent:page_type", "page_type"]];
  $byCustom = []; $missing = [];
  foreach ($custom as $key => [$api, $param]) {
    $c = stike_ga4_batch([stike_ga4_rep([$api], ["eventCount"], stike_an_cur($r), ["event" => ["whatsapp_click"], "order" => stike_ga4_order_metric("eventCount"), "limit" => 20])]);
    if (!empty($c["ok"])) $byCustom[$key] = array_map(fn($x) => ["name" => (string)$x[$api], "clicks" => stike_an_n($x, "eventCount")], $c["reports"][0] ?? []);
    elseif (($c["code"] ?? "") === "ga4_bad_field") { $byCustom[$key] = null; $missing[] = $param; }
    else return $c;
  }
  return ["ok" => true, "range" => $r, "total" => $total,
    "byDevice" => array_map(fn($x) => ["name" => (string)$x["deviceCategory"], "clicks" => stike_an_n($x, "eventCount")], $dev),
    "bySource" => array_map(fn($x) => ["name" => (string)$x["sessionSourceMedium"], "clicks" => stike_an_n($x, "eventCount")], $src),
    "byLocation" => $byCustom["location"] ?? null, "byPageType" => $byCustom["pageType"] ?? null, "missingDimensions" => $missing];
}

/* ============================================ GA4: tiempo real ============================================ */
function stike_an_realtime() {
  $total = stike_ga4_realtime(["metrics" => [["name" => "activeUsers"]]]);
  if (empty($total["ok"])) return $total;
  $pages = stike_ga4_realtime(["dimensions" => [["name" => "unifiedScreenName"]], "metrics" => [["name" => "activeUsers"]], "limit" => "8", "orderBys" => stike_ga4_order_metric("activeUsers")]);
  $events = stike_ga4_realtime(["dimensions" => [["name" => "eventName"]], "metrics" => [["name" => "eventCount"]], "limit" => "10", "orderBys" => stike_ga4_order_metric("eventCount")]);
  $cities = stike_ga4_realtime(["dimensions" => [["name" => "city"]], "metrics" => [["name" => "activeUsers"]], "limit" => "6", "orderBys" => stike_ga4_order_metric("activeUsers")]);
  return ["ok" => true, "activeUsers" => (int)($total["rows"][0]["activeUsers"] ?? 0),
    "pages" => array_map(fn($x) => ["name" => (string)$x["unifiedScreenName"], "users" => stike_an_n($x, "activeUsers")], $pages["rows"] ?? []),
    "events" => array_map(fn($x) => ["name" => (string)$x["eventName"], "count" => stike_an_n($x, "eventCount")], $events["rows"] ?? []),
    "cities" => array_values(array_filter(array_map(fn($x) => ["name" => (string)$x["city"], "users" => stike_an_n($x, "activeUsers")], $cities["rows"] ?? []), fn($x) => $x["name"] !== "" && $x["name"] !== "(not set)"))];
}

/* ============================================ Search Console ============================================ */
function stike_an_search($key) {
  $g = stike_an_range($key, 2);   // Search Console tiene los datos con ~2 dias de retraso
  $q = fn($dims, $limit, $from, $to) => stike_gsc_query(["startDate" => $from, "endDate" => $to, "dimensions" => $dims, "rowLimit" => $limit, "dataState" => "final"]);
  $series = $q(["date"], 400, $g["from"], $g["to"]);
  if (empty($series["ok"])) return $series;
  $prev = $q([], 1, $g["prevFrom"], $g["prevTo"]);
  if (empty($prev["ok"])) return $prev;
  $queries = $q(["query"], 250, $g["from"], $g["to"]);
  if (empty($queries["ok"])) return $queries;
  $pages = $q(["page"], 100, $g["from"], $g["to"]);
  if (empty($pages["ok"])) return $pages;
  $dev = $q(["device"], 5, $g["from"], $g["to"]);
  $ctry = $q(["country"], 8, $g["from"], $g["to"]);
  $row = fn($x) => ["clicks" => $x["clicks"], "impressions" => $x["impressions"], "ctr" => $x["ctr"], "position" => $x["position"]];
  $cur = ["clicks" => 0, "impressions" => 0, "ctr" => 0, "position" => 0]; $wpos = 0;
  $days = [];
  foreach ($series["rows"] as $x) { $cur["clicks"] += $x["clicks"]; $cur["impressions"] += $x["impressions"]; $wpos += $x["position"] * $x["impressions"]; $days[] = ["date" => (string)($x["keys"][0] ?? ""), "clicks" => $x["clicks"], "impressions" => $x["impressions"], "ctr" => $x["ctr"], "position" => $x["position"]]; }
  $cur["ctr"] = $cur["impressions"] > 0 ? $cur["clicks"] / $cur["impressions"] : 0;
  $cur["position"] = $cur["impressions"] > 0 ? $wpos / $cur["impressions"] : 0;
  $pr = $prev["rows"][0] ?? ["clicks" => 0, "impressions" => 0, "ctr" => 0, "position" => 0];
  $qs = array_map(fn($x) => ["query" => (string)($x["keys"][0] ?? "")] + $row($x), $queries["rows"]);
  $brand = ["clicks" => 0, "impressions" => 0]; $nonBrand = ["clicks" => 0, "impressions" => 0];
  foreach ($qs as $x) { $isBrand = stripos($x["query"], "stike") !== false || stripos($x["query"], "stik e") !== false; $t = $isBrand ? "brand" : "nonBrand"; $$t["clicks"] += $x["clicks"]; $$t["impressions"] += $x["impressions"]; }
  $opps = array_values(array_filter($qs, fn($x) => $x["position"] >= 4 && $x["position"] <= 20 && $x["impressions"] >= 20));
  usort($opps, fn($a, $b) => $b["impressions"] <=> $a["impressions"]);
  return ["ok" => true, "range" => $g,
    "totals" => ["cur" => $cur, "prev" => $row($pr)], "series" => $days,
    "queries" => array_slice($qs, 0, 50), "opportunities" => array_slice($opps, 0, 20), "brand" => $brand, "nonBrand" => $nonBrand,
    "pages" => array_slice(array_map(fn($x) => ["page" => (string)($x["keys"][0] ?? "")] + $row($x), $pages["rows"]), 0, 40),
    "devices" => empty($dev["ok"]) ? [] : array_map(fn($x) => ["name" => (string)($x["keys"][0] ?? "")] + $row($x), $dev["rows"]),
    "countries" => empty($ctry["ok"]) ? [] : array_map(fn($x) => ["name" => (string)($x["keys"][0] ?? "")] + $row($x), $ctry["rows"])];
}
function stike_an_sitemaps() {
  $r = stike_gsc_sitemaps();
  if (empty($r["ok"])) return $r;
  $out = [];
  foreach (is_array($r["json"]["sitemap"] ?? null) ? $r["json"]["sitemap"] : [] as $s) {
    $sub = 0; $idx = 0;
    foreach (is_array($s["contents"] ?? null) ? $s["contents"] : [] as $c) { $sub += (int)($c["submitted"] ?? 0); $idx += (int)($c["indexed"] ?? 0); }
    $out[] = ["path" => (string)($s["path"] ?? ""), "lastSubmitted" => (string)($s["lastSubmitted"] ?? ""), "lastDownloaded" => (string)($s["lastDownloaded"] ?? ""), "pending" => !empty($s["isPending"]), "errors" => (int)($s["errors"] ?? 0), "warnings" => (int)($s["warnings"] ?? 0), "submitted" => $sub, "indexed" => $idx];
  }
  return ["ok" => true, "sitemaps" => $out];
}

/* ============================================ contador propio ============================================ */
function stike_an_top_map($m, $n) { if (!is_array($m)) return []; arsort($m); $o = []; foreach (array_slice($m, 0, $n, true) as $k => $v) $o[] = ["name" => (string)$k, "n" => (int)$v]; return $o; }
function stike_an_firstparty($r) {
  $s = stike_fp_summary($r["from"], $r["to"]);
  $p = stike_fp_summary($r["prevFrom"], $r["prevTo"]);
  $ev = [];
  foreach ($s["ev"] as $name => $e) {
    $ev[$name] = ["n" => $e["n"], "prev" => $p["ev"][$name]["n"] ?? 0, "loc" => stike_an_top_map($e["loc"] ?? null, 20), "pt" => stike_an_top_map($e["pt"] ?? null, 12), "path" => stike_an_top_map($e["path"] ?? null, 15),
      "slug" => stike_an_top_map($e["slug"] ?? null, 15), "dev" => stike_an_top_map($e["dev"] ?? null, 3), "hour" => $e["hour"] ?? [], "ref" => stike_an_top_map($e["ref"] ?? null, 8), "q" => stike_an_top_map($e["q"] ?? null, 20), "m" => stike_an_top_map($e["m"] ?? null, 8), "f" => stike_an_top_map($e["f"] ?? null, 4)];
  }
  return ["ok" => true, "range" => $r, "first" => $s["first"], "ev" => $ev, "days" => $s["days"]];
}

/* ============================================ prueba de conexion ============================================ */
function stike_an_test() {
  $checks = []; $add = function ($id, $ok, $label, $detail) use (&$checks) { $checks[] = ["id" => $id, "ok" => $ok, "label" => $label, "detail" => $detail]; };
  $sa = stike_g_sa();
  if (!$sa) { $add("sa", false, "Cuenta de servicio de Google", "Todavía no hay una llave guardada. Pega el JSON de la cuenta de servicio (paso 3 de la guía)."); return ["ok" => true, "checks" => $checks]; }
  $add("sa", true, "Cuenta de servicio de Google", $sa["email"] . ($sa["project"] !== "" ? " (proyecto " . $sa["project"] . ")" : "") . ". Agrégala como lector en GA4 y en Search Console.");

  // --- GA4
  $prop = stike_ga4_property();
  if (!$prop) $add("ga4", false, "Google Analytics 4: propiedad", "Falta el ID de propiedad (solo números: Administrar → Detalles de la propiedad).");
  else {
    $meta = stike_ga4_metadata();
    if (empty($meta["ok"])) $add("ga4", false, "Google Analytics 4: acceso", $meta["detail"]);
    else {
      $dims = array_map(fn($d) => (string)($d["apiName"] ?? ""), is_array($meta["json"]["dimensions"] ?? null) ? $meta["json"]["dimensions"] : []);
      $add("ga4", true, "Google Analytics 4: acceso", "La cuenta lee la propiedad " . $prop . ".");
      $missing = array_values(array_filter(["link_location", "page_type"], fn($p) => !in_array("customEvent:" . $p, $dims, true)));
      $add("ga4_dims", !$missing, "GA4: dimensiones personalizadas", $missing ? "Falta registrar " . implode(" y ", $missing) . " (Administrar → Definiciones personalizadas → Crear dimensión personalizada → alcance «Evento»; el nombre del parámetro es exactamente ese). Sin ellas no se puede ver en GA4 dónde estaban los botones de WhatsApp (el contador propio sí lo muestra)." : "link_location y page_type registradas: los clics a WhatsApp se pueden ver por lugar.");
      $rg = stike_an_range("28d");
      $evs = stike_ga4_batch([stike_ga4_rep(["eventName"], ["eventCount"], stike_an_cur($rg), ["event" => ["page_view", "whatsapp_click", "view_item", "add_to_cart", "begin_checkout", "purchase"], "limit" => 20])]);
      if (empty($evs["ok"])) $add("ga4_events", false, "GA4: eventos de la tienda", $evs["detail"]);
      else {
        $seen = []; foreach ($evs["reports"][0] ?? [] as $x) $seen[(string)$x["eventName"]] = (int)$x["eventCount"];
        $add("ga4_data", ($seen["page_view"] ?? 0) > 0, "GA4: datos llegando", ($seen["page_view"] ?? 0) > 0 ? number_format($seen["page_view"], 0, ",", ".") . " visitas a páginas en los últimos 28 días." : "GA4 todavía no recibió visitas. ¿Ya está el ID de medición (G-…) en Analítica → Medición del sitio y publicado? Los datos tardan unos minutos en aparecer (hasta 24 h en algunos reportes).");
        $need = ["whatsapp_click", "view_item", "add_to_cart", "begin_checkout", "purchase"]; $lack = array_values(array_filter($need, fn($e) => empty($seen[$e])));
        $add("ga4_events", !$lack, "GA4: eventos de la tienda", $lack ? "Todavía no han llegado: " . implode(", ", $lack) . " (en 28 días). Es normal si aún no ha pasado (por ejemplo «purchase» hasta la primera compra con el medidor)." : "Llegan whatsapp_click, view_item, add_to_cart, begin_checkout y purchase.");
      }
    }
  }

  // --- Search Console
  $site = stike_gsc_site();
  if (!$site) $add("gsc", false, "Search Console: propiedad", "Falta la propiedad (por ejemplo sc-domain:stikebikeshop.com, o con dirección: https://stikebikeshop.com/).");
  else {
    $list = stike_gsc_sites();
    if (empty($list["ok"])) $add("gsc", false, "Search Console: acceso", $list["detail"]);
    else {
      $found = null;
      foreach (is_array($list["json"]["siteEntry"] ?? null) ? $list["json"]["siteEntry"] : [] as $e) if (is_array($e) && ($e["siteUrl"] ?? "") === $site) $found = $e;
      if (!$found) $add("gsc", false, "Search Console: acceso", "La cuenta de servicio no tiene la propiedad «" . $site . "» entre las suyas. En Search Console → Configuración → Usuarios y permisos agrega " . $sa["email"] . ", y revisa que el nombre esté escrito igual (" . (count($list["json"]["siteEntry"] ?? []) ? "ve: " . implode(", ", array_map(fn($e) => (string)($e["siteUrl"] ?? ""), array_slice($list["json"]["siteEntry"], 0, 4))) : "no ve ninguna propiedad todavía") . ").");
      else {
        $lvl = ["siteOwner" => "propietario", "siteFullUser" => "completo", "siteRestrictedUser" => "restringido", "siteUnverifiedUser" => "sin verificar"][$found["permissionLevel"] ?? ""] ?? (string)($found["permissionLevel"] ?? "");
        $add("gsc", ($found["permissionLevel"] ?? "") !== "siteUnverifiedUser", "Search Console: acceso", "Propiedad «" . $site . "», permiso " . $lvl . ".");
        $g = stike_an_range("28d", 2);
        $d = stike_gsc_query(["startDate" => $g["from"], "endDate" => $g["to"], "dimensions" => [], "rowLimit" => 1]);
        if (empty($d["ok"])) $add("gsc_data", false, "Search Console: datos", $d["detail"]);
        else { $c = (int)($d["rows"][0]["clicks"] ?? 0); $im = (int)($d["rows"][0]["impressions"] ?? 0); $add("gsc_data", $im > 0, "Search Console: datos", $im > 0 ? number_format($im, 0, ",", ".") . " impresiones y " . number_format($c, 0, ",", ".") . " clics en Google en 28 días." : "Todavía no hay datos de búsqueda (una propiedad nueva tarda unos días en empezar a mostrarlos)."); }
        $sm = stike_gsc_sitemaps();
        if (!empty($sm["ok"])) { $n = count(is_array($sm["json"]["sitemap"] ?? null) ? $sm["json"]["sitemap"] : []); $add("gsc_sitemap", $n > 0, "Search Console: sitemap", $n > 0 ? $n . " sitemap(s) enviado(s)." : "No hay ningún sitemap enviado. Pulsa «Enviar sitemap» (la cuenta necesita permiso «Completo») o envíalo en Search Console → Sitemaps: " . stike_public_base() . "/sitemap.xml"); }
      }
    }
  }

  // --- el sitio y el contador propio
  $fp = stike_fp_summary(stike_fp_when(time() - 6 * 86400)[0], stike_fp_when()[0]);
  $n = array_sum(array_map(fn($e) => $e["n"], $fp["ev"]));
  $add("fp", $n > 0, "Contador propio", $n > 0 ? number_format($n, 0, ",", ".") . " eventos anotados en los últimos 7 días." : "Todavía no hay eventos (se anotan solos cuando alguien visita el sitio; no cuentan los navegadores del equipo).");
  $pub = is_file(__DIR__ . "/../data/analytics.json") ? json_decode((string)@file_get_contents(__DIR__ . "/../data/analytics.json"), true) : [];
  $mid = is_array($pub) ? (string)($pub["ga4MeasurementId"] ?? "") : "";
  $add("site_id", preg_match('/^G-[A-Z0-9]{6,14}$/', $mid) === 1, "El sitio manda datos a GA4", $mid !== "" ? "ID de medición " . $mid . " publicado en el sitio." : "Falta el ID de medición (G-…): Analítica → Medición del sitio.");
  return ["ok" => true, "checks" => $checks];
}

/* ============================================ la puerta ============================================ */
stike_run(function () {
  $method = $_SERVER["REQUEST_METHOD"] ?? "GET";
  if (!in_array($method, ["GET", "POST"], true)) throw new ApiError(405, "method_not_allowed");
  if ($method === "POST") stike_admin_check_origin();
  $s = stike_admin_require();
  if (!stike_admin_sees_finance($s["role"])) throw new ApiError(403, "forbidden");
  $body = $method === "POST" ? stike_json_body() : [];
  $view = (string)($method === "POST" ? ($body["view"] ?? "") : ($_GET["view"] ?? "status"));
  $range = stike_an_range((string)($_GET["range"] ?? $body["range"] ?? "28d"));
  $refresh = !empty($_GET["refresh"]) && !stike_rate_limited("an-refresh", 30, 300);
  $both = in_array($s["role"], ["owner", "developer"], true);

  if ($method === "POST") {
    if (!$both) throw new ApiError(403, "forbidden");
    if (stike_rate_limited("an-post", 20, 300)) throw new ApiError(429, "too_many_requests");
    if ($view === "test") respond(200, stike_an_test());
    if ($view === "sitemap_submit") {
      $r = stike_gsc_submit_sitemap(stike_public_base() . "/sitemap.xml");
      if (empty($r["ok"])) respond(200, $r + ["setup" => "gsc"]);
      respond(200, ["ok" => true, "sitemap" => stike_public_base() . "/sitemap.xml"]);
    }
    throw new ApiError(400, "invalid_view");
  }

  switch ($view) {
    case "status":      respond(200, stike_an_status());
    case "summary":     respond(200, stike_an_view("summary", $range, $refresh, STIKE_AN_TTL, fn() => stike_an_summary($range)));
    case "acquisition": respond(200, stike_an_view("acquisition", $range, $refresh, STIKE_AN_TTL, fn() => stike_an_acquisition($range)));
    case "pages":       respond(200, stike_an_view("pages", $range, $refresh, STIKE_AN_TTL, fn() => stike_an_pages($range)));
    case "products":    respond(200, stike_an_view("products", $range, $refresh, STIKE_AN_TTL, fn() => stike_an_products($range)));
    case "audience":    respond(200, stike_an_view("audience", $range, $refresh, STIKE_AN_TTL, fn() => stike_an_audience($range)));
    case "whatsapp":    respond(200, stike_an_view("whatsapp", $range, $refresh, STIKE_AN_TTL, fn() => stike_an_whatsapp($range)));
    case "realtime":    respond(200, stike_an_view("realtime", ["from" => "", "to" => ""], $refresh, STIKE_AN_TTL_RT, fn() => stike_an_realtime()));
    case "search":      respond(200, stike_an_view("search", $range, $refresh, STIKE_AN_TTL_GSC, fn() => stike_an_search($range["key"])));
    case "sitemaps":    respond(200, stike_an_view("sitemaps", ["from" => "", "to" => ""], $refresh, 300, fn() => stike_an_sitemaps()));
    case "firstparty":  respond(200, stike_an_firstparty($range));
    default: throw new ApiError(400, "invalid_view");
  }
});
