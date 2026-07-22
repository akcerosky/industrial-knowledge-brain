import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Search, Sparkles, Waypoints } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";

type GraphNode = {
  id: string;
  label: string;
  kind: string;
};

type GraphEdge = {
  source: string;
  target: string;
  label: string;
};

type GraphResponse = {
  root_tag: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type GraphExplorerProps = {
  selectedTag: string;
};

type SearchResult = {
  label: string;
  key: string;
  display_name: string;
};

const kindColor: Record<string, string> = {
  Equipment: "oklch(0.58 0.22 275)", // Cyber Indigo
  Document: "oklch(0.50 0.04 240)", // Sleek Gray-Blue
  InspectionEvent: "oklch(0.65 0.15 150)", // Sage Green
  Procedure: "oklch(0.65 0.16 310)", // Soft Violet
  RegulatoryRef: "oklch(0.58 0.18 25)", // Coral Red
  Organization: "oklch(0.70 0.12 210)", // Electric Cyan
  Product: "oklch(0.75 0.14 75)", // Bronze / Amber
  Concept: "oklch(0.62 0.08 170)", // Desaturated Forest
  Person: "oklch(0.68 0.10 290)", // Cosmic Orchid
};

export function GraphExplorerPage({ selectedTag }: GraphExplorerProps) {
  const [query, setQuery] = useState(selectedTag || "P-101A");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    const initialQuery = selectedTag || "P-101A";
    setQuery(initialQuery);
    setSelected({ label: "Equipment", key: initialQuery, display_name: initialQuery });
  }, [selectedTag]);

  useEffect(() => {
    let active = true;
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      apiFetch(`/api/graph/search?q=${encodeURIComponent(trimmed)}`)
        .then(async (response) => {
          if (!response.ok) return;
          const payload = (await response.json()) as { results: SearchResult[] };
          if (active) {
            setSearchResults(payload.results);
          }
        })
        .catch(() => {
          if (active) setSearchResults([]);
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [query]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setIsLoading(true);
    setError(null);
    setSelectedNode(null);

    const graphPath =
      selected.label === "Equipment"
        ? `/api/graph/${encodeURIComponent(selected.key)}`
        : `/api/graph/node/${encodeURIComponent(selected.label)}/${encodeURIComponent(selected.key)}`;

    apiFetch(graphPath)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load graph for ${selected.display_name}`);
        }
        return (await response.json()) as GraphResponse;
      })
      .then((payload) => {
        if (active) {
          setGraph(payload);
        }
      })
      .catch((graphError) => {
        if (active) {
          setError(graphError instanceof Error ? graphError.message : "Unable to load graph.");
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selected]);

  const RING_ORDER = ["Equipment", "InspectionEvent", "RegulatoryRef", "Procedure", "Document"];
  const BASE_RADIUS = 110;
  const RING_GAP = 90;
  const MIN_ARC_SPACING = 58;
  const NODE_RADIUS = 24;
  const PADDING = 60;

  const { layout, canvasWidth, canvasHeight } = useMemo(() => {
    if (!graph || !graph.nodes.length) {
      return { layout: [] as Array<GraphNode & { x: number; y: number }>, canvasWidth: 760, canvasHeight: 500 };
    }

    const byKind = new Map<string, GraphNode[]>();
    for (const node of graph.nodes) {
      if (node.id === graph.root_tag) continue;
      const bucket = byKind.get(node.kind) ?? [];
      bucket.push(node);
      byKind.set(node.kind, bucket);
    }

    const orderedKinds = [
      ...RING_ORDER.filter((kind) => byKind.has(kind)),
      ...[...byKind.keys()].filter((kind) => !RING_ORDER.includes(kind)),
    ];

    const positioned: Array<GraphNode & { x: number; y: number }> = [];
    let maxRadius = 0;

    orderedKinds.forEach((kind, ringIndex) => {
      const nodes = byKind.get(kind) ?? [];
      const minRadiusForCount = (nodes.length * MIN_ARC_SPACING) / (2 * Math.PI);
      const radius = Math.max(BASE_RADIUS + ringIndex * RING_GAP, minRadiusForCount);
      maxRadius = Math.max(maxRadius, radius);
      const ringOffset = (ringIndex * Math.PI) / 5;
      nodes.forEach((node, i) => {
        const angle = ringOffset + (i / nodes.length) * Math.PI * 2;
        positioned.push({
          ...node,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        });
      });
    });

    const half = maxRadius + NODE_RADIUS + PADDING;
    const size = half * 2;
    const rootNode = graph.nodes.find((node) => node.id === graph.root_tag);
    const centered = [
      ...(rootNode ? [{ ...rootNode, x: half, y: half }] : []),
      ...positioned.map((node) => ({ ...node, x: node.x + half, y: node.y + half })),
    ];

    return { layout: centered, canvasWidth: size, canvasHeight: size };
  }, [graph]);

  function labelFor(node: { label: string; kind: string }, isRoot: boolean) {
    const maxChars = isRoot ? 16 : 14;
    return node.label.length > maxChars ? `${node.label.slice(0, maxChars - 1)}…` : node.label;
  }

  const connectedEdgesForSelected = useMemo(() => {
    if (!selectedNode || !graph) return [];
    return graph.edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id);
  }, [selectedNode, graph]);

  return (
    <Card className="border border-slate-200 bg-white shadow-sm relative overflow-hidden rounded-lg">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Waypoints className="size-4" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Knowledge Graph Topology</p>
          </div>
          <CardTitle className="mt-1 text-lg font-bold">Interactive Entity Relationship Map</CardTitle>
          <p className="mt-1.5 text-xs text-slate-500">
            Search for equipment tags, documents, or regulations. Click any node to inspect connected relationships.
          </p>
        </div>

        {/* Autocomplete Search Bar */}
        <div className="relative flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-3.5 text-slate-400" />
            <Input
              className="w-56 pl-9 rounded-lg bg-slate-50 border-slate-200 focus:border-primary focus:bg-white focus:outline-none transition-all text-xs"
              id="graph-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search P-101A, OSHA, Maintenance..."
              value={query}
            />
          </div>

          {searchResults.length > 0 ? (
            <div className="absolute top-full right-0 z-30 mt-2 w-72 rounded-lg border border-slate-200 bg-white shadow-md overflow-hidden">
              <div className="px-3 py-1.5 border-b border-slate-200 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                Matching Graph Entities:
              </div>
              {searchResults.map((result) => (
                <button
                  key={`${result.label}-${result.key}`}
                  className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-xs hover:bg-slate-100 transition-colors cursor-pointer"
                  onClick={() => {
                    setSelected(result);
                    setQuery(result.display_name);
                    setSearchResults([]);
                  }}
                  type="button"
                >
                  <span className="truncate font-bold text-slate-900">{result.display_name}</span>
                  <Badge variant="outline" className="text-[9px] uppercase font-mono border-sky-200 text-sky-700">
                    {result.label}
                  </Badge>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="grid gap-5 px-5 pt-5 pb-5 xl:grid-cols-[minmax(0,1.2fr)_280px]">
        {/* SVG Canvas */}
        <div className="h-[calc(100vh-280px)] min-h-[400px] overflow-auto rounded-lg bg-slate-50 p-4 border border-slate-200 scrollbar-thin relative flex justify-center items-center">
          {isLoading ? (
            <div className="grid h-[calc(100vh-320px)] min-h-[350px] w-full place-items-center">
              <Skeleton className="h-[calc(100vh-360px)] min-h-[320px] w-[95%] rounded-lg bg-slate-100" />
            </div>
          ) : null}

          {error ? (
            <Alert className="m-4 border-destructive/30 bg-destructive/10 text-destructive-foreground" variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle className="text-sm font-bold">Graph Error</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : null}

          {!error && !isLoading && graph ? (
            <div className="transition-transform duration-300">
              <svg
                height={Math.min(canvasHeight, 800)}
                width={Math.min(canvasWidth, 800)}
                viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
                className="mx-auto select-none"
              >
                <defs>
                  <filter id="glow-heavy" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="10" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                  <filter id="glow-light" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Graph Edges */}
                {graph.edges.map((edge) => {
                  const source = layout.find((node) => node.id === edge.source);
                  const target = layout.find((node) => node.id === edge.target);
                  if (!source || !target) return null;

                  const isEdgeConnectedToSelected =
                    selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id);

                  const labelX = (source.x + target.x) / 2;
                  const labelY = (source.y + target.y) / 2;

                  return (
                    <g key={`${edge.source}-${edge.target}-${edge.label}`}>
                      <line
                        stroke={isEdgeConnectedToSelected ? "var(--primary)" : "#e2e8f0"}
                        strokeWidth={isEdgeConnectedToSelected ? "2" : "1"}
                        x1={source.x}
                        x2={target.x}
                        y1={source.y}
                        y2={target.y}
                        strokeDasharray={isEdgeConnectedToSelected ? undefined : "3 3"}
                        className="transition-all duration-300"
                      />
                      <g transform={`translate(${labelX}, ${labelY})`}>
                        <rect
                          x="-28"
                          y="-7"
                          width="56"
                          height="12"
                          rx="3"
                          fill="var(--card)"
                          stroke={isEdgeConnectedToSelected ? "var(--primary)" : "#cbd5e1"}
                          strokeWidth="1"
                        />
                        <text
                          fill={isEdgeConnectedToSelected ? "var(--primary)" : "#64748b"}
                          fontSize="7"
                          fontWeight="800"
                          textAnchor="middle"
                          y="1.5"
                          className="font-mono tracking-wider"
                        >
                          {edge.label}
                        </text>
                      </g>
                    </g>
                  );
                })}

                {/* Graph Nodes */}
                {layout.map((node) => {
                  const isRoot = node.id === graph.root_tag;
                  const isSelected = selectedNode?.id === node.id;
                  const color = kindColor[node.kind] ?? "var(--muted-foreground)";

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      className="cursor-pointer group"
                      onClick={() => setSelectedNode(node)}
                    >
                      <title>{`${node.label} (${node.kind})`}</title>

                      {/* Pulse Halo for Root or Selected Node */}
                      {(isRoot || isSelected) ? (
                        <circle
                          r={isRoot ? 42 : 32}
                          fill={color}
                          opacity="0.15"
                          className="animate-ping"
                        />
                      ) : null}

                      <circle
                        fill={isRoot ? color : "var(--card)"}
                        opacity={1}
                        r={isRoot ? 36 : isSelected ? 28 : NODE_RADIUS}
                        filter={isRoot || isSelected ? "url(#glow-heavy)" : "url(#glow-light)"}
                        stroke={isRoot ? "#ffffff" : color}
                        strokeWidth={isSelected ? "3.5" : isRoot ? "2" : "1.5"}
                        className="transition-all duration-300 group-hover:scale-110"
                      />

                      <text
                        fill={isRoot ? "#ffffff" : "var(--foreground)"}
                        fontSize={isRoot ? "10" : "8"}
                        fontWeight="800"
                        textAnchor="middle"
                        y="3"
                        className="pointer-events-none tracking-wider select-none font-mono"
                      >
                        {labelFor(node, isRoot)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : null}
        </div>

        {/* Side Inspector Panel */}
        <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 flex flex-col gap-4">
          {selectedNode ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm animate-fade-in">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500">Properties</span>
                <Badge variant="outline" className="text-[9px] font-mono border-sky-200 text-sky-700 bg-sky-50">
                  {selectedNode.kind}
                </Badge>
              </div>

              <p className="mt-2.5 text-base font-bold text-slate-900 tracking-wide">{selectedNode.label}</p>
              <p className="mt-0.5 text-[10px] text-slate-500 font-mono">ID: {selectedNode.id}</p>

              <div className="mt-4 pt-3 border-t border-slate-200 space-y-2 text-xs">
                <p className="text-[9px] font-mono font-bold uppercase tracking-widest text-primary">Edges ({connectedEdgesForSelected.length})</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin pr-1">
                  {connectedEdgesForSelected.map((edge) => (
                    <div key={`${edge.source}-${edge.target}-${edge.label}`} className="rounded bg-slate-50 p-2 text-[10px] border border-slate-100 font-mono shadow-sm">
                      <span className="font-bold text-slate-900">{edge.label}</span>
                      <span className="text-slate-500 block text-[9px] mt-0.5 truncate">
                        {edge.source === selectedNode.id ? `➔ ${edge.target}` : `⬅ ${edge.source}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="mt-4 w-full text-xs text-slate-650 hover:text-slate-800 cursor-pointer hover:bg-slate-100 rounded-lg"
                onClick={() => setSelectedNode(null)}
              >
                Close Inspector
              </Button>
            </div>
          ) : (
            <div className="rounded-lg bg-white px-4 py-3.5 border border-slate-200 shadow-sm">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
                <Sparkles className="size-3.5" />
                Node Inspector
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Click any circle node on the graph to inspect its entity properties, connected documents, and relationship edges.
              </p>
            </div>
          )}

          <div>
            <p className="text-[9px] font-mono font-black tracking-widest uppercase text-slate-500 mb-3">Entity Legend</p>
            <div className="grid gap-2">
              {Object.entries(kindColor).map(([kind, color]) => (
                <div key={kind} className="flex items-center justify-between text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <span className="size-2.5 rounded-full border border-slate-200 shadow-sm shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-[11px] font-medium">{kind}</span>
                  </div>
                  <span className="text-[9px] font-mono opacity-60">
                    {graph?.nodes.filter((n) => n.kind === kind).length || 0}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-auto text-[10px] leading-relaxed text-slate-500 pt-3 border-t border-slate-200">
            Topology centers on root entity <span className="font-mono text-primary font-bold">{graph?.root_tag || "P-101A"}</span> with sub-rings for linked procedures &amp; regulations.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
