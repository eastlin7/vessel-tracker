"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const STRAIT_CENTER: [number, number] = [54.0, 26.0];
const INITIAL_ZOOM = 5.5;

interface SnapshotMeta {
  id: string;
  fetchedAt: string;
  count: number;
}

const ALIGNMENT_COLORS: Record<string, string> = {
  green: "#00cc66",
  blue: "#4488ff",
  red: "#ff4444",
  yellow: "#ddaa00",
};

const ALIGNMENT_MATCH = [
  "match",
  ["get", "alignment"],
  "green",
  "#00cc66",
  "blue",
  "#4488ff",
  "red",
  "#ff4444",
  "yellow",
  "#ddaa00",
  "#ddaa00",
] as maplibregl.ExpressionSpecification;

const STROKE_MATCH = [
  "match",
  ["get", "alignment"],
  "green",
  "#004d26",
  "blue",
  "#1a3366",
  "red",
  "#661a1a",
  "yellow",
  "#665500",
  "#665500",
] as maplibregl.ExpressionSpecification;

export default function Map() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [shipCount, setShipCount] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [activeSnapshot, setActiveSnapshot] = useState<string | null>(null);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);

  const updateMap = useCallback(
    (geojson: GeoJSON.FeatureCollection, trails: GeoJSON.FeatureCollection) => {
      const map = mapRef.current;
      if (!map) return;
      const shipsSource = map.getSource("ships") as maplibregl.GeoJSONSource;
      if (shipsSource) shipsSource.setData(geojson);
      const trailsSource = map.getSource("trails") as maplibregl.GeoJSONSource;
      if (trailsSource) trailsSource.setData(trails);
    },
    []
  );

  async function loadCached() {
    const res = await fetch("/api/ships");
    const data = await res.json();
    setShipCount(data._meta?.count ?? data.features?.length ?? 0);
    setFetchedAt(data._meta?.fetchedAt ?? null);
    setSnapshots(data._meta?.snapshots ?? []);
    if (data._meta?.snapshots?.[0]) {
      setActiveSnapshot(data._meta.snapshots[0].id);
    }
    const trails = data.trails ?? { type: "FeatureCollection", features: [] };
    updateMap(data, trails);
    setLoading(false);
  }

  async function handleRefresh() {
    const token = prompt("Password:");
    if (!token) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/vessels/refresh", {
        method: "POST",
        headers: { "x-sync-token": token },
      });
      const data = await res.json();
      if (data.error) {
        alert("Refresh failed: " + data.error);
        return;
      }
      setShipCount(data.count);
      setFetchedAt(data.fetchedAt);
      setSnapshots(data.snapshots ?? []);
      if (data.snapshots?.[0]) setActiveSnapshot(data.snapshots[0].id);
      updateMap(
        data.geojson,
        data.trails ?? { type: "FeatureCollection", features: [] }
      );
    } catch {
      alert("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function loadSnapshot(id: string) {
    setActiveSnapshot(id);
    const res = await fetch(`/api/snapshots?id=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (data.error) return;
    setShipCount(data.count);
    setFetchedAt(data.fetchedAt);
    updateMap(
      data.geojson,
      data.trails ?? { type: "FeatureCollection", features: [] }
    );
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json",
      center: STRAIT_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      // Trail lines source + layer (rendered below ships)
      map.addSource("trails", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "trails-lines",
        type: "line",
        source: "trails",
        paint: {
          "line-color": ALIGNMENT_MATCH,
          "line-width": 2,
          "line-opacity": 0.4,
          "line-dasharray": [2, 2],
        },
      });

      // Ships source
      map.addSource("ships", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "ships-circles",
        type: "circle",
        source: "ships",
        paint: {
          "circle-radius": 5,
          "circle-color": ALIGNMENT_MATCH,
          "circle-stroke-width": 1,
          "circle-stroke-color": STROKE_MATCH,
          "circle-opacity": 0.9,
        },
      });

      map.addLayer({
        id: "ships-labels",
        type: "symbol",
        source: "ships",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, -1.5],
          "text-anchor": "bottom",
          "text-allow-overlap": false,
          "text-ignore-placement": false,
        },
        paint: {
          "text-color": ALIGNMENT_MATCH,
          "text-halo-color": "#000000",
          "text-halo-width": 1,
        },
      });

      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        maxWidth: "280px",
      });

      map.on("click", "ships-circles", (e) => {
        if (!e.features?.length) return;
        const props = e.features[0].properties;
        const coords = (e.features[0].geometry as GeoJSON.Point).coordinates;

        popup
          .setLngLat(coords as [number, number])
          .setHTML(
            `<div style="font-family:system-ui;font-size:13px;line-height:1.5">
              <strong>${props.flagEmoji} ${props.name || "Unknown"}</strong>
              ${props.shadowFleet === true || props.shadowFleet === "true" ? '<span style="color:#ff4444;font-weight:bold;margin-left:4px">[Shadow Fleet]</span>' : ""}<br/>
              <span style="color:#aaa">Flag:</span> ${props.flagCountry}<br/>
              <span style="color:#aaa">Alignment:</span> ${props.alignment === "green" ? "US-aligned" : props.alignment === "blue" ? "EU-aligned" : props.alignment === "red" ? "China/Russia-aligned" : "Non-aligned"}<br/>
              ${props.sanctioners ? `<span style="color:#aaa">Sanctioned by:</span> ${props.sanctioners}<br/>` : ""}
              <span style="color:#aaa">Speed:</span> ${props.sog} kn<br/>
              <span style="color:#aaa">MMSI:</span> <a href="https://www.vesselfinder.com/vessels/details/${props.mmsi}" target="_blank" rel="noopener noreferrer" style="color:#00ff88;text-decoration:none">${props.mmsi}</a>
            </div>`
          )
          .addTo(map);
      });

      map.on("mouseenter", "ships-circles", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "ships-circles", () => {
        map.getCanvas().style.cursor = "";
      });

      loadCached();
    });

    return () => {
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const timeLabel = fetchedAt
    ? new Date(fetchedAt).toLocaleString()
    : "never";

  return (
    <div style={{ position: "relative", width: "100vw", height: "100dvh" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          background: "rgba(0,0,0,0.8)",
          color: "#fff",
          padding: "8px 14px",
          borderRadius: 8,
          fontSize: 13,
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          gap: 10,
          backdropFilter: "blur(4px)",
        }}
      >
        <span
          className={loading ? "status-dot loading" : "status-dot"}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: loading ? "#ffaa00" : shipCount > 0 ? "#00ff88" : "#ffaa00",
            display: "inline-block",
          }}
        />
        <span>
          <strong>Persian Gulf</strong> &mdash;{" "}
          {loading ? "Loading..." : `${shipCount} ships`}
        </span>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="sync-btn"
        >
          {refreshing ? "Syncing..." : "Sync"}
        </button>
        <button
          onClick={() => setAboutOpen(true)}
          className="about-btn-inline"
          aria-label="About this project"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
      </div>

      {/* About panel */}
      {aboutOpen && (
        <div className="about-overlay" onClick={() => setAboutOpen(false)}>
          <div className="about-panel" onClick={(e) => e.stopPropagation()}>
            <button className="about-close" onClick={() => setAboutOpen(false)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: "#fff" }}>
              Strait of Hormuz Tracker
            </h2>
            <p style={{ color: "#aaa", lineHeight: 1.6, marginBottom: 12 }}>
              Periodically updated visualization of maritime traffic through
              one of the world&apos;s most strategically important waterways.
              Ships are color-coded by geopolitical alignment and tracked
              using AIS transponder data.
            </p>
            <p style={{ color: "#aaa", lineHeight: 1.6, marginBottom: 16 }}>
              Built with Next.js, MapLibre GL, and AIS vessel data.
              Snapshots are captured periodically to show traffic patterns
              over time.
            </p>
            <div style={{ borderTop: "1px solid #333", paddingTop: 12 }}>
              <p style={{ color: "#ccc", fontSize: 13 }}>
                Made by{" "}
                <a
                  href="https://emil.ostlin.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#00ff88", textDecoration: "none" }}
                >
                  Emil Ostlin
                </a>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          position: "absolute",
          bottom: 30,
          left: 12,
          background: "rgba(0,0,0,0.8)",
          color: "#fff",
          padding: "8px 12px",
          borderRadius: 8,
          fontSize: 11,
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          gap: 12,
          backdropFilter: "blur(4px)",
        }}
      >
        {Object.entries(ALIGNMENT_COLORS).map(([key, color]) => (
          <span key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: color,
                display: "inline-block",
              }}
            />
            {key === "green"
              ? "US-aligned"
              : key === "blue"
                ? "EU-aligned"
                : key === "red"
                  ? "China/Russia-aligned"
                  : "Non-aligned"}
          </span>
        ))}
      </div>

      {/* Footer attribution */}
      <div className="footer-bar">
        <span>
          Built by{" "}
          <a
            href="https://emil.ostlin.dev"
            target="_blank"
            rel="noopener noreferrer"
          >
            Emil Ostlin
          </a>
        </span>
      </div>

      {/* Snapshot selector */}
      {snapshots.length > 0 && (
        <div className="snapshots-panel">
          <button
            className="snapshots-toggle"
            onClick={() => setSnapshotsOpen(!snapshotsOpen)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>Snapshots ({snapshots.length})</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              style={{
                transform: snapshotsOpen ? "rotate(180deg)" : "rotate(0)",
                transition: "transform 0.2s",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {snapshotsOpen && (
            <div className="snapshots-list">
              {snapshots.map((s) => {
                const isActive = s.id === activeSnapshot;
                const d = new Date(s.fetchedAt);
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      loadSnapshot(s.id);
                      setSnapshotsOpen(false);
                    }}
                    style={{
                      padding: "4px 8px",
                      marginBottom: 2,
                      borderRadius: 4,
                      cursor: "pointer",
                      background: isActive
                        ? "rgba(255,255,255,0.1)"
                        : "transparent",
                      borderLeft: isActive
                        ? "2px solid #00ff88"
                        : "2px solid transparent",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ color: isActive ? "#00ff88" : "#ccc" }}>
                      {d.toLocaleDateString()} {d.toLocaleTimeString()}
                    </span>
                    <span style={{ color: "#666", marginLeft: 6 }}>
                      {s.count} ships
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
