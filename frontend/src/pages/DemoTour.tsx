import { useState, useEffect } from "react";
import { 
  Play, Pause, RotateCcw, ChevronLeft, ChevronRight, PlayCircle,
  MousePointer, Radio, Waypoints, Database, Wrench, 
  Sparkles, ShieldCheck, Check, Send, AlertTriangle, 
  HelpCircle, BarChart3, Clock
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SubStep {
  cursorX: number; // percentage from left
  cursorY: number; // percentage from top
  clicked: boolean;
  narratorText: string;
  viewState: string; // key representing the state of the mock screen
}

interface Scene {
  id: number;
  title: string;
  tab: "copilot" | "assets" | "workflows" | "intelligence" | "administration";
  substeps: SubStep[];
}

export function DemoTourPage() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const [currentSubStepIdx, setCurrentSubStepIdx] = useState(0);
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);
  const [isSandboxMode, setIsSandboxMode] = useState(false);
  
  // Custom states for step 5 operator assignment and step 2 ask sequence
  const [step5Assigned, setStep5Assigned] = useState(false);
  const [step2Input, setStep2Input] = useState("");
  const [step2ResponseVisible, setStep2ResponseVisible] = useState(false);
  const [step3Expanded, setStep3Expanded] = useState(false);

  const scenes: Scene[] = [
    {
      id: 1,
      title: "1. Workspace & Context Selection",
      tab: "copilot",
      substeps: [
        {
          cursorX: 45,
          cursorY: 15,
          clicked: false,
          narratorText: "We start in our clean Copilot workspace. To begin analyzing asset health, we first select our equipment context.",
          viewState: "clean_copilot_dropdown_closed"
        },
        {
          cursorX: 70,
          cursorY: 30,
          clicked: true,
          narratorText: "We open the asset filter dropdown and search for our target pump. We locate and select 'Cooling Water Pump P-204'.",
          viewState: "clean_copilot_dropdown_open"
        },
        {
          cursorX: 70,
          cursorY: 30,
          clicked: false,
          narratorText: "Pump P-204 is now pinned as our active workspace context. The graph and vector databases are scoped to this pump.",
          viewState: "copilot_pinned_p204"
        }
      ]
    },
    {
      id: 2,
      title: "2. Asking Failure Question",
      tab: "copilot",
      substeps: [
        {
          cursorX: 40,
          cursorY: 82,
          clicked: true,
          narratorText: "Now, we will ask our primary failure question to pinpoint the root cause of the pump's performance degradation.",
          viewState: "copilot_focus_input"
        },
        {
          cursorX: 40,
          cursorY: 82,
          clicked: false,
          narratorText: "Typing: 'What caused the recent high vibration and low discharge pressure event on Pump P-204, and what evidence supports this?'",
          viewState: "copilot_typing_question"
        },
        {
          cursorX: 86,
          cursorY: 82,
          clicked: true,
          narratorText: "We submit the query. The system launches a hybrid traversal across Postgres vector indexes and Neo4j graph nodes.",
          viewState: "copilot_submitting_question"
        },
        {
          cursorX: 50,
          cursorY: 50,
          clicked: false,
          narratorText: "The system streams back the cited, graph-corroborated answer. It highlights a critical suction strainer clogging issue on STR-204.",
          viewState: "copilot_streaming_answer"
        }
      ]
    },
    {
      id: 3,
      title: "3. Expanding Evidence Panel",
      tab: "copilot",
      substeps: [
        {
          cursorX: 30,
          cursorY: 60,
          clicked: false,
          narratorText: "Let's inspect the evidence. Look at the citation chips at the bottom of the response, linking directly to source materials.",
          viewState: "copilot_viewing_citations"
        },
        {
          cursorX: 30,
          cursorY: 66,
          clicked: true,
          narratorText: "We hover over the citation chip for 'Inspection Report IR-P204-0319' and click to open the document viewer.",
          viewState: "copilot_clicking_citation"
        },
        {
          cursorX: 85,
          cursorY: 50,
          clicked: false,
          narratorText: "The Evidence Panel expands on the right, loading the live, raw inspection report details highlighting the 75% biological scaling.",
          viewState: "copilot_evidence_expanded"
        }
      ]
    },
    {
      id: 4,
      title: "4. Asset Timeline & Graph",
      tab: "assets",
      substeps: [
        {
          cursorX: 10,
          cursorY: 20,
          clicked: true,
          narratorText: "To see the chronological progression and relationships, we head over to the Assets tab in the main sidebar.",
          viewState: "assets_overview"
        },
        {
          cursorX: 45,
          cursorY: 48,
          clicked: true,
          narratorText: "We open the Asset Timeline. This view organizes sensor alerts, inspection reports, and repair records in sequence.",
          viewState: "assets_timeline"
        },
        {
          cursorX: 58,
          cursorY: 48,
          clicked: true,
          narratorText: "Next, we toggle the Relationships view to display the Neo4j graph topology. We see the direct connections centered on P-204.",
          viewState: "assets_relationships"
        }
      ]
    },
    {
      id: 5,
      title: "5. Root Cause & Action Board",
      tab: "workflows",
      substeps: [
        {
          cursorX: 10,
          cursorY: 26,
          clicked: true,
          narratorText: "With root cause evidence gathered, we switch to Workflows to initiate standard governance and validation actions.",
          viewState: "workflows_rca_overview"
        },
        {
          cursorX: 40,
          cursorY: 35,
          clicked: false,
          narratorText: "The system ranks causal hypotheses: Strainer Blockage leading to Cavitation is ranked #1 with 92% confidence.",
          viewState: "workflows_ranked_hypotheses"
        },
        {
          cursorX: 78,
          cursorY: 54,
          clicked: true,
          narratorText: "We select the highest priority action: 'Field calibration and check of DPI-204', and click 'Assign to Operator'.",
          viewState: "workflows_assigning_action"
        },
        {
          cursorX: 78,
          cursorY: 54,
          clicked: false,
          narratorText: "The validation action is officially assigned to Shift A. The system locks this under human-in-the-loop audit logs.",
          viewState: "workflows_action_assigned"
        }
      ]
    },
    {
      id: 6,
      title: "6. Compliance Gap Audits",
      tab: "intelligence",
      substeps: [
        {
          cursorX: 10,
          cursorY: 32,
          clicked: true,
          narratorText: "Next, we pivot to compliance and risk analysis by navigating to the Intelligence dashboard.",
          viewState: "intelligence_compliance_overview"
        },
        {
          cursorX: 48,
          cursorY: 55,
          clicked: false,
          narratorText: "The compliance engine automatically alerts us to a major safety gap: Pump P-204 lacks a post-repair vibration validation baseline record.",
          viewState: "intelligence_compliance_gap"
        }
      ]
    },
    {
      id: 7,
      title: "7. Metrics & Expected Impact",
      tab: "administration",
      substeps: [
        {
          cursorX: 10,
          cursorY: 38,
          clicked: true,
          narratorText: "Finally, we check our system governance metrics under the Administration tab.",
          viewState: "administration_metrics"
        },
        {
          cursorX: 50,
          cursorY: 50,
          clicked: false,
          narratorText: "The Golden Evaluation Suite reports a 98% factual correctness score, proving the system avoided 48 hours of unplanned downtime.",
          viewState: "administration_impact"
        }
      ]
    }
  ];

  const currentScene = scenes[currentSceneIdx];
  const currentSubStep = currentScene.substeps[currentSubStepIdx];

  // Auto-play timer
  useEffect(() => {
    if (!isPlaying) return;

    const baseDelay = 4500; // 4.5 seconds per substep
    const delay = baseDelay / speed;

    const timer = setTimeout(() => {
      handleNext();
    }, delay);

    return () => clearTimeout(timer);
  }, [isPlaying, currentSceneIdx, currentSubStepIdx, speed]);

  // Sync virtual state transitions when steps change automatically
  useEffect(() => {
    const state = currentSubStep.viewState;
    if (state === "copilot_typing_question") {
      setStep2Input("What caused the recent high vibration and low discharge pressure event on Pump P-204, and what evidence supports this?");
      setStep2ResponseVisible(false);
    } else if (state === "copilot_streaming_answer") {
      setStep2Input("What caused the recent high vibration and low discharge pressure event on Pump P-204, and what evidence supports this?");
      setStep2ResponseVisible(true);
    } else if (state === "copilot_evidence_expanded") {
      setStep3Expanded(true);
    } else if (state === "workflows_action_assigned") {
      setStep5Assigned(true);
    }
  }, [currentSubStep]);

  const handleNext = () => {
    if (currentSubStepIdx < currentScene.substeps.length - 1) {
      setCurrentSubStepIdx(prev => prev + 1);
    } else if (currentSceneIdx < scenes.length - 1) {
      setCurrentSceneIdx(prev => prev + 1);
      setCurrentSubStepIdx(0);
    } else {
      setIsPlaying(false); // End of tour
    }
  };

  const handlePrev = () => {
    if (currentSubStepIdx > 0) {
      setCurrentSubStepIdx(prev => prev - 1);
    } else if (currentSceneIdx > 0) {
      setCurrentSceneIdx(prev => prev - 1);
      setCurrentSubStepIdx(scenes[currentSceneIdx - 1].substeps.length - 1);
    }
  };

  const handleReset = () => {
    setCurrentSceneIdx(0);
    setCurrentSubStepIdx(0);
    setIsPlaying(false);
    setStep5Assigned(false);
    setStep2Input("");
    setStep2ResponseVisible(false);
    setStep3Expanded(false);
  };

  const handleSelectScene = (sceneIdx: number) => {
    setCurrentSceneIdx(sceneIdx);
    setCurrentSubStepIdx(0);
  };

  // Calculate overall progress percentage
  const totalSubsteps = scenes.reduce((acc, scene) => acc + scene.substeps.length, 0);
  let passedSubsteps = 0;
  for (let i = 0; i < currentSceneIdx; i++) {
    passedSubsteps += scenes[i].substeps.length;
  }
  passedSubsteps += currentSubStepIdx + 1;
  const progressPercent = Math.round((passedSubsteps / totalSubsteps) * 100);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Overview Card */}
      <Card className="border border-slate-200 bg-white shadow-sm overflow-hidden rounded-xl">
        <div className="p-6 relative z-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1.5">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-250">
                <PlayCircle className="size-3 fill-current" />
                <span>Interactive Product Demo</span>
              </span>
              <h2 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
                Expert Knowledge Copilot Demo Tour
              </h2>
              <p className="text-sm text-slate-500 max-w-3xl leading-relaxed font-medium font-sans">
                Watch the automated tour of the 3-minute product demo script for **Pump P-204**. 
                You can play, pause, jump between scenes, or toggle **Sandbox Mode** to interact directly with the simulated screen.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className={`text-[10px] font-bold h-7 px-2.5 rounded-md ${speed === 1 ? "bg-white text-primary shadow-sm" : "text-slate-600"}`} 
                  onClick={() => setSpeed(1)}
                >
                  1x
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className={`text-[10px] font-bold h-7 px-2.5 rounded-md ${speed === 1.5 ? "bg-white text-primary shadow-sm" : "text-slate-600"}`} 
                  onClick={() => setSpeed(1.5)}
                >
                  1.5x
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className={`text-[10px] font-bold h-7 px-2.5 rounded-md ${speed === 2 ? "bg-white text-primary shadow-sm" : "text-slate-600"}`} 
                  onClick={() => setSpeed(2)}
                >
                  2x
                </Button>
              </div>
              
              <Button
                variant={isSandboxMode ? "default" : "outline"}
                size="sm"
                className="text-xs font-bold rounded-lg px-4 h-9"
                onClick={() => {
                  setIsSandboxMode(!isSandboxMode);
                  if (!isSandboxMode) setIsPlaying(false);
                }}
              >
                {isSandboxMode ? "Exit Sandbox" : "Enter Sandbox"}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Main Workspace Player Grid */}
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        
        {/* Left Playlist sidebar */}
        <div className="space-y-4">
          <Card className="border border-slate-200 bg-white shadow-sm rounded-xl">
            <CardHeader className="border-b border-slate-100 p-4">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">Demo Scenes</CardTitle>
            </CardHeader>
            <CardContent className="p-3 space-y-1">
              {scenes.map((scene, idx) => (
                <button
                  key={scene.id}
                  type="button"
                  onClick={() => handleSelectScene(idx)}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all ${
                    currentSceneIdx === idx
                      ? "border-primary bg-primary/5 text-primary shadow-sm"
                      : "border-slate-100 bg-white hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold leading-tight">{scene.title}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider">
                      View: {scene.tab}
                    </p>
                  </div>
                  {currentSceneIdx === idx && isPlaying && (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                  )}
                  {currentSceneIdx > idx && (
                    <Check className="size-4 text-emerald-600 shrink-0" />
                  )}
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Narrator Speech Bubbles */}
          <Card className="border border-amber-250 bg-amber-50/50 shadow-sm rounded-xl overflow-hidden">
            <div className="bg-amber-100 px-4 py-2 border-b border-amber-200 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                <Radio className="size-3 animate-pulse text-amber-600" />
                Live Narration Transcript
              </span>
              <Clock className="size-3.5 text-amber-700" />
            </div>
            <CardContent className="p-4">
              <p className="text-xs font-semibold leading-relaxed text-amber-900">
                &quot;{currentSubStep.narratorText}&quot;
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right Simulator Viewport */}
        <div className="flex flex-col gap-4">
          
          {/* Virtual Browser Screen */}
          <div className="relative border border-slate-300 rounded-xl bg-slate-900 shadow-2xl overflow-hidden aspect-[16/10] w-full min-h-[500px]">
            
            {/* Virtual mouse cursor */}
            {!isSandboxMode && (
              <div 
                className="absolute z-50 pointer-events-none transition-all duration-700 ease-in-out"
                style={{ 
                  left: `${currentSubStep.cursorX}%`, 
                  top: `${currentSubStep.cursorY}%`,
                }}
              >
                <div className={`relative ${currentSubStep.clicked ? "scale-90" : "scale-100"}`}>
                  <MousePointer className="size-6 text-black fill-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] transform -rotate-[22deg]" />
                  {currentSubStep.clicked && (
                    <span className="absolute -top-1 -left-1 size-8 rounded-full border-4 border-sky-400 bg-sky-400/20 animate-ping" />
                  )}
                </div>
              </div>
            )}

            {/* Faux Browser Header */}
            <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex items-center justify-between text-xs shrink-0 select-none">
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-rose-500" />
                <span className="size-2.5 rounded-full bg-amber-500" />
                <span className="size-2.5 rounded-full bg-emerald-500" />
                <span className="ml-2 font-mono text-[10px] text-slate-400 font-bold bg-slate-950/40 px-2 py-0.5 rounded">
                  http://127.0.0.1:5173/demo-simulation
                </span>
              </div>
              <Badge className="bg-sky-500/20 hover:bg-sky-500/20 text-sky-400 border-sky-500/30 text-[9px] font-bold rounded px-2">
                {isSandboxMode ? "INTERACTIVE SANDBOX MODE" : "AUTOMATED PLAYBACK"}
              </Badge>
            </div>

            {/* Virtual Application UI Container */}
            <div className="flex bg-slate-50 text-foreground w-full h-[calc(100%-32px)] overflow-hidden text-xs">
              
              {/* Virtual Sidebar */}
              <aside className="w-48 bg-white border-r border-slate-200 flex flex-col p-3 gap-4 shrink-0 select-none">
                <div className="flex items-center gap-2">
                  <div className="rounded bg-sky-500/10 p-1.5 text-sky-600">
                    <Radio className="size-4" />
                  </div>
                  <div>
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-700 block leading-none">Citation-Grounded AI</span>
                    <span className="text-[8px] text-slate-400 font-mono">Operations Brain</span>
                  </div>
                </div>
                
                <nav className="flex-1 space-y-1">
                  <div className="text-[8px] font-black uppercase text-slate-400 px-2 mb-1.5 tracking-wider">NAVIGATE</div>
                  <VirtualTabBtn active={currentScene.tab === "copilot"} label="Copilot" icon={<Radio className="size-3.5" />} />
                  <VirtualTabBtn active={currentScene.tab === "assets"} label="Assets" icon={<Waypoints className="size-3.5" />} />
                  <VirtualTabBtn active={currentScene.tab === "workflows"} label="Workflows" icon={<Wrench className="size-3.5" />} />
                  <VirtualTabBtn active={currentScene.tab === "intelligence"} label="Intelligence" icon={<Sparkles className="size-3.5" />} />
                  <VirtualTabBtn active={currentScene.tab === "administration"} label="Administration" icon={<ShieldCheck className="size-3.5" />} />
                </nav>
                
                <div className="border-t border-slate-100 pt-3">
                  <div className="rounded bg-slate-50 border border-slate-150 p-2 text-[8px] text-slate-500 font-medium">
                    <p className="font-bold text-slate-800">Connected</p>
                    <p className="mt-0.5">Postgres Vector + Neo4j</p>
                  </div>
                </div>
              </aside>

              {/* Virtual Main View */}
              <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 relative">
                
                {/* 1. COPILOT TAB VIEW */}
                {currentScene.tab === "copilot" && (
                  <div className="flex-1 flex flex-col h-full gap-4">
                    
                    {/* Header Workspace Context Selection */}
                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                      <div>
                        <h3 className="font-bold text-slate-900">Expert Knowledge Copilot</h3>
                        <p className="text-[10px] text-slate-500">Workspace scoped query execution</p>
                      </div>
                      <div className="relative">
                        <button 
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg bg-white font-mono text-[10px] font-bold text-slate-800 shadow-sm"
                          disabled={!isSandboxMode}
                          onClick={() => {}}
                        >
                          Context:{" "}
                          <span className={currentSubStep.viewState !== "clean_copilot_dropdown_closed" ? "text-primary font-extrabold" : "text-slate-500"}>
                            {currentSubStep.viewState === "clean_copilot_dropdown_closed" ? "None (Global)" : "Pump P-204"}
                          </span>
                        </button>

                        {/* Dropdown open mockup */}
                        {currentSubStep.viewState === "clean_copilot_dropdown_open" && (
                          <div className="absolute right-0 mt-1.5 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-40 select-none">
                            <div className="px-2.5 py-1 text-[8px] font-bold text-slate-400 tracking-wider">SELECT CONTEXT</div>
                            <div className="px-2.5 py-1.5 hover:bg-slate-50 font-mono text-[9px] text-slate-600 cursor-pointer">P-101A (Feed Pump)</div>
                            <div className="px-2.5 py-1.5 bg-primary/10 text-primary font-bold font-mono text-[9px] cursor-pointer flex items-center justify-between">
                              <span>P-204 (Cooling Pump)</span>
                              <Check className="size-3" />
                            </div>
                            <div className="px-2.5 py-1.5 hover:bg-slate-50 font-mono text-[9px] text-slate-600 cursor-pointer">TK-77 (Storage Tank)</div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Chat Area Grid (Main Chat / Right Evidence Panel) */}
                    <div className="flex-1 grid grid-cols-[1fr_240px] gap-4 min-h-0 relative">
                      
                      {/* Chat Messages */}
                      <div className="border border-slate-200 rounded-xl bg-white p-3 flex flex-col justify-between shadow-sm overflow-y-auto">
                        <div className="space-y-4">
                          
                          {/* System Intro Message */}
                          <div className="flex gap-2 items-start">
                            <div className="size-6 rounded bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                              <Radio className="size-3.5" />
                            </div>
                            <div className="bg-slate-100 p-2.5 rounded-lg text-slate-700 max-w-[85%]">
                              <p className="font-bold text-[9px] text-slate-800">Expert Knowledge Copilot</p>
                              <p className="mt-0.5 text-[9px] leading-relaxed">
                                Pin an equipment context and ask a question. The system will synthesize a hybrid response grounded in procedures, drawings, manuals, and inspection logs.
                              </p>
                            </div>
                          </div>

                          {/* User Message (Step 2/3) */}
                          {step2Input && (
                            <div className="flex gap-2 items-start justify-end">
                              <div className="bg-primary text-primary-foreground p-2.5 rounded-lg max-w-[85%] shadow-sm">
                                <p className="font-bold text-[9px] opacity-80">You (Operator)</p>
                                <p className="mt-0.5 text-[9px] leading-relaxed font-semibold">
                                  {step2Input}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Assistant Streamed Answer (Step 2 Sub-step 3 & Step 3) */}
                          {step2ResponseVisible && (
                            <div className="flex gap-2 items-start animate-fade-in">
                              <div className="size-6 rounded bg-primary/10 flex items-center justify-center text-primary shrink-0">
                                <Radio className="size-3.5" />
                              </div>
                              <div className="border border-slate-200 p-3 rounded-lg bg-slate-50 text-slate-700 max-w-[85%] space-y-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[9px] font-black text-slate-900 flex items-center gap-1">
                                    <Sparkles className="size-3 text-sky-500 fill-sky-500/10" />
                                    HYBRID CITATION RESPONSE
                                  </span>
                                  <Badge className="bg-success/15 text-success border-success/20 text-[8px] font-bold">
                                    92% Grounding Confidence
                                  </Badge>
                                </div>
                                <p className="text-[9px] leading-relaxed font-medium">
                                  The recent high vibration (spiking to <strong>8.5 mm/s</strong>) and low discharge pressure (dropping to <strong>2.1 bar</strong>) on <strong>Cooling Water Pump P-204</strong> on <strong>2025-03-18</strong> was triggered by <strong>severe suction cavitation</strong>. 
                                  This occurred due to a 75% flow-restriction blockage at suction strainer <strong>STR-204</strong>, causing flow imbalance and subsequent seal/shaft-sleeve degradation.
                                </p>
                                
                                <div className="border-t border-slate-200 pt-2 space-y-1.5">
                                  <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Source Evidence (3 references):</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    <span 
                                      className={`px-2 py-0.5 rounded text-[8px] font-bold border font-mono cursor-pointer transition-all ${
                                        currentSubStep.viewState === "copilot_clicking_citation" || currentSubStep.viewState === "copilot_evidence_expanded"
                                          ? "bg-primary border-primary text-white shadow-sm scale-105"
                                          : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                                      }`}
                                    >
                                      [IR-P204-0319] Inspection Report
                                    </span>
                                    <span className="px-2 py-0.5 rounded text-[8px] font-bold border font-mono bg-white border-slate-200 text-slate-600">
                                      [WO-99210] Work Order
                                    </span>
                                    <span className="px-2 py-0.5 rounded text-[8px] font-bold border font-mono bg-white border-slate-200 text-slate-600">
                                      [OEM-P204-Sec4] Maintenance Manual
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                        </div>

                        {/* Input Area */}
                        <div className="border-t border-slate-100 pt-2 mt-4 flex gap-2">
                          <input
                            type="text"
                            placeholder="Ask about P-204 maintenance, manuals, drawing links..."
                            className="flex-1 bg-slate-50 border border-slate-200 rounded px-2.5 py-1 text-[9px]"
                            disabled
                            value={currentSubStep.viewState === "copilot_typing_question" ? "What caused the recent high vibration..." : step2Input}
                          />
                          <Button size="icon" className="size-6 bg-primary text-white rounded shrink-0">
                            <Send className="size-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Right Evidence panel container */}
                      <div className="border border-slate-200 rounded-xl bg-white p-3 flex flex-col gap-2 shadow-sm overflow-hidden select-none">
                        <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2 text-[9px] font-bold text-slate-700">
                          <Database className="size-3.5 text-primary" />
                          Source Evidence Panel
                        </div>
                        
                        {step3Expanded ? (
                          <div className="flex-1 flex flex-col gap-2 animate-fade-in text-[8px]">
                            <div className="rounded bg-primary/5 border border-primary/20 p-2">
                              <p className="font-bold text-slate-800 font-sans">Inspection Report IR-P204-0319</p>
                              <div className="flex items-center justify-between text-[7px] text-slate-400 mt-0.5 font-mono">
                                <span>Date: 2025-03-19</span>
                                <span>Confidence: 98%</span>
                              </div>
                            </div>
                            
                            <div className="flex-1 bg-slate-50 border border-slate-200 rounded p-2 overflow-y-auto font-mono text-[7.5px] leading-relaxed text-slate-700 space-y-2">
                              <p className="font-bold text-primary border-b pb-0.5">Section 2.3 — Suction Assembly</p>
                              <p>
                                &quot;Suction strainer <strong>STR-204</strong> was dismantled and inspected following telemetry reports of high cavitation noise. 
                                The mesh basket was found to be <strong>75% blinded</strong> by iron oxide sludge and heavy biological scaling.&quot;
                              </p>
                              <p>
                                &quot;This severe restriction reduced the suction flow velocity by 40%, generating cavitation bubbles which entered the pump chamber. 
                                Severe pitting was observed on the impeller face, leading to high-frequency shaft vibration and wear sleeve failures.&quot;
                              </p>
                              <div className="bg-amber-105 text-amber-900 border border-amber-250 p-1.5 rounded text-[7px] font-sans">
                                <strong>Recommended Action:</strong> Flush suction basket immediately and run post-repair baseline vibration spectrum validation tests.
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400">
                            <HelpCircle className="size-6 text-slate-300 mb-1" />
                            <p className="text-[9px] font-bold">No Citation Selected</p>
                            <p className="text-[8px] max-w-[150px] mx-auto mt-0.5">Click a citation bracket to inspect raw text evidence live.</p>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                )}


                {/* 2. ASSETS TAB VIEW */}
                {currentScene.tab === "assets" && (
                  <div className="flex-1 flex flex-col gap-3">
                    
                    {/* Header */}
                    <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-slate-900">Asset Profile: Pump P-204</h3>
                        <p className="text-[10px] text-slate-500">Utilities / Cooling Water System / P-204</p>
                      </div>
                      <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] font-bold">
                        Vessel Class A
                      </Badge>
                    </div>

                    {/* Sub-tabs */}
                    <div className="flex gap-1.5 border-b border-slate-200 pb-1.5">
                      <span className={`px-2.5 py-1 rounded text-[8px] font-bold border cursor-pointer ${currentSubStep.viewState === "assets_overview" ? "bg-primary border-primary text-white" : "bg-white text-slate-600"}`}>Overview</span>
                      <span className={`px-2.5 py-1 rounded text-[8px] font-bold border cursor-pointer ${currentSubStep.viewState === "assets_timeline" ? "bg-primary border-primary text-white" : "bg-white text-slate-600"}`}>Timeline</span>
                      <span className={`px-2.5 py-1 rounded text-[8px] font-bold border cursor-pointer ${currentSubStep.viewState === "assets_relationships" ? "bg-primary border-primary text-white" : "bg-white text-slate-600"}`}>Relationships</span>
                    </div>

                    {/* Content Panel Mock */}
                    <div className="flex-1 bg-white border border-slate-200 rounded-xl p-3 shadow-sm min-h-0 overflow-y-auto">
                      
                      {/* Asset Overview */}
                      {currentSubStep.viewState === "assets_overview" && (
                        <div className="space-y-3 animate-fade-in">
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-slate-50 p-2 rounded border border-slate-100">
                              <p className="text-[8px] font-bold text-slate-400">INSPECTIONS</p>
                              <p className="text-base font-bold text-slate-800">8 Logs</p>
                            </div>
                            <div className="bg-slate-50 p-2 rounded border border-slate-100">
                              <p className="text-[8px] font-bold text-slate-400">COMPLIANCE</p>
                              <p className="text-base font-bold text-amber-700">1 Warning</p>
                            </div>
                            <div className="bg-slate-50 p-2 rounded border border-slate-100">
                              <p className="text-[8px] font-bold text-slate-400">PROCEDURES</p>
                              <p className="text-base font-bold text-slate-800">4 SOPs</p>
                            </div>
                          </div>
                          
                          <div className="rounded bg-slate-50 border p-2.5 text-[8.5px]">
                            <p className="font-bold text-slate-800">AI-generated Asset Brief</p>
                            <p className="mt-1 leading-relaxed text-slate-600">
                              P-204 is a critical cooling water circulation pump at Dahej. It recently suffered a severe vibration spike leading to shaft wear. Diagnostics show a history of suction strainer clogging under biological scaling conditions, governed by OSHA LOTO guidelines during inspections.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Asset Timeline */}
                      {currentSubStep.viewState === "assets_timeline" && (
                        <div className="space-y-3 animate-fade-in relative pl-4 border-l border-slate-200">
                          
                          {/* Event 1 */}
                          <div className="relative">
                            <span className="absolute -left-[20.5px] top-1.5 size-3 rounded-full bg-rose-500 border-2 border-white" />
                            <div className="bg-slate-50 p-2 rounded border border-slate-200">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-[9px] text-slate-800">Telemetry Alarm: High Vibration</span>
                                <span className="text-[8px] font-mono text-slate-400">2025-03-18</span>
                              </div>
                              <p className="text-[8px] text-slate-500 mt-0.5">Vibration reached 8.5 mm/s (Alarm Limit: 4.5 mm/s). Discharge pressure dropped to 2.1 bar.</p>
                            </div>
                          </div>

                          {/* Event 2 */}
                          <div className="relative">
                            <span className="absolute -left-[20.5px] top-1.5 size-3 rounded-full bg-primary border-2 border-white" />
                            <div className="bg-slate-50 p-2 rounded border border-slate-200">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-[9px] text-slate-800">Suction Strainer Inspection IR-P204</span>
                                <span className="text-[8px] font-mono text-slate-400">2025-03-19</span>
                              </div>
                              <p className="text-[8px] text-slate-500 mt-0.5">Field inspection found strainer STR-204 basket 75% blocked by biological mud/sludge.</p>
                            </div>
                          </div>

                          {/* Event 3 */}
                          <div className="relative">
                            <span className="absolute -left-[20.5px] top-1.5 size-3 rounded-full bg-emerald-500 border-2 border-white" />
                            <div className="bg-slate-50 p-2 rounded border border-slate-200">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-[9px] text-slate-800">Corrective Work Order WO-99210</span>
                                <span className="text-[8px] font-mono text-slate-400">2025-03-20</span>
                              </div>
                              <p className="text-[8px] text-slate-500 mt-0.5">Strainer basket flushed. Shaft sleeves replaced. Alignment verified inside tolerances.</p>
                            </div>
                          </div>

                        </div>
                      )}

                      {/* Asset Relationships (Graph View) */}
                      {currentSubStep.viewState === "assets_relationships" && (
                        <div className="h-full min-h-[220px] flex items-center justify-center animate-fade-in relative bg-slate-900 rounded-lg p-2 overflow-hidden border border-slate-800">
                          
                          {/* SVG Relationships graph mockup */}
                          <svg className="w-full h-full min-h-[200px]" viewBox="0 0 360 200">
                            {/* Lines */}
                            <line x1="180" y1="100" x2="70" y2="40" stroke="#0284c7" strokeWidth="1.5" strokeDasharray="3,3" />
                            <line x1="180" y1="100" x2="290" y2="40" stroke="#059669" strokeWidth="1.5" />
                            <line x1="180" y1="100" x2="70" y2="160" stroke="#ef4444" strokeWidth="1.5" />
                            <line x1="180" y1="100" x2="290" y2="160" stroke="#d97706" strokeWidth="1.5" />
                            
                            {/* Labels on lines */}
                            <text x="125" y="65" fill="#38bdf8" fontSize="7" textAnchor="middle" fontWeight="bold">CONTAINS</text>
                            <text x="235" y="65" fill="#34d399" fontSize="7" textAnchor="middle" fontWeight="bold">CORRECTS</text>
                            <text x="125" y="140" fill="#f87171" fontSize="7" textAnchor="middle" fontWeight="bold">GOVERNED_BY</text>
                            <text x="235" y="140" fill="#fbbf24" fontSize="7" textAnchor="middle" fontWeight="bold">DOCUMENTED_IN</text>

                            {/* Center Node (Pump P-204) */}
                            <circle cx="180" cy="100" r="18" fill="#0284c7" className="animate-pulse" />
                            <text x="180" y="103" fill="#ffffff" fontSize="7" textAnchor="middle" fontWeight="bold">P-204</text>
                            
                            {/* STR-204 Node */}
                            <circle cx="70" cy="40" r="14" fill="#0369a1" />
                            <text x="70" y="43" fill="#ffffff" fontSize="6.5" textAnchor="middle" fontWeight="bold">STR-204</text>
                            
                            {/* WO-99210 Node */}
                            <circle cx="290" cy="40" r="14" fill="#059669" />
                            <text x="290" y="43" fill="#ffffff" fontSize="6.5" textAnchor="middle" fontWeight="bold">WO-99210</text>
                            
                            {/* OSHA Regulation Node */}
                            <circle cx="70" cy="160" r="14" fill="#dc2626" />
                            <text x="70" y="163" fill="#ffffff" fontSize="5.5" textAnchor="middle" fontWeight="bold">OSHA LOTO</text>
                            
                            {/* Inspection Event Node */}
                            <circle cx="290" cy="160" r="14" fill="#d97706" />
                            <text x="290" y="163" fill="#ffffff" fontSize="6" textAnchor="middle" fontWeight="bold">IR-P204</text>
                          </svg>

                          <div className="absolute top-2 right-2 flex flex-wrap gap-1 select-none">
                            <span className="text-[6.5px] font-mono px-1 rounded bg-sky-500/25 border border-sky-400/30 text-sky-400">Equipment</span>
                            <span className="text-[6.5px] font-mono px-1 rounded bg-emerald-500/25 border border-emerald-400/30 text-emerald-400">WorkOrder</span>
                            <span className="text-[6.5px] font-mono px-1 rounded bg-red-500/25 border border-red-400/30 text-red-400">Regulation</span>
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                )}


                {/* 3. WORKFLOWS TAB VIEW */}
                {currentScene.tab === "workflows" && (
                  <div className="flex-1 flex flex-col gap-3">
                    
                    {/* Header */}
                    <div className="border-b border-slate-200 pb-3">
                      <h3 className="font-bold text-slate-900">Agentic Workflow Board</h3>
                      <p className="text-[10px] text-slate-500">Governance, verification and operator dispatch tasks</p>
                    </div>

                    {/* RCA ranked hypotheses */}
                    <div className="space-y-2">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Root Cause Hypothesis Ranking (Pump P-204):</p>
                      
                      <div className="space-y-1.5">
                        {/* Hypothesis 1 */}
                        <div className="rounded-lg border border-primary/25 bg-primary/5 p-2 flex items-center justify-between shadow-sm">
                          <div className="space-y-0.5">
                            <span className="text-[8px] font-extrabold uppercase bg-primary/10 text-primary px-1.5 py-0.25 rounded">Rank 1 (92% Conf.)</span>
                            <p className="text-[9.5px] font-bold text-slate-900">STR-204 Suction Strainer biological clogging leading to cavitation</p>
                          </div>
                          <Badge className="bg-sky-500/20 text-sky-600 font-mono text-[8px]">Primary Cause</Badge>
                        </div>

                        {/* Hypothesis 2 */}
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 flex items-center justify-between text-slate-500">
                          <div className="space-y-0.5">
                            <span className="text-[8px] font-bold uppercase bg-slate-200 text-slate-600 px-1.5 py-0.25 rounded">Rank 2 (45% Conf.)</span>
                            <p className="text-[9.5px] font-medium text-slate-700">Shaft misalignment following structural thermal shifts</p>
                          </div>
                          <Badge variant="outline" className="text-[8px]">Secondary</Badge>
                        </div>
                      </div>
                    </div>

                    {/* Validation action card */}
                    <div className="border border-slate-200 rounded-xl p-3 bg-white mt-2 shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="text-[9.5px] font-bold text-slate-800 flex items-center gap-1.5">
                          <Wrench className="size-3.5 text-amber-500" />
                          Recommended Validation Action
                        </span>
                        <Badge className={step5Assigned ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}>
                          {step5Assigned ? "Assigned" : "Pending Human Action"}
                        </Badge>
                      </div>

                      <div className="text-[8.5px] text-slate-600 space-y-1">
                        <p><strong>Action:</strong> Run field calibration of differential pressure indicator (DPI-204) across the strainer assembly.</p>
                        <p><strong>Rationale:</strong> Accurate telemetry of pressure drops isolates the block state from impeller mechanical loss.</p>
                      </div>

                      <div className="flex justify-end pt-1">
                        <Button 
                          size="sm" 
                          className={`text-[9px] font-bold px-3 py-1 rounded transition-all cursor-pointer ${
                            step5Assigned 
                              ? "bg-emerald-600 hover:bg-emerald-600 text-white" 
                              : "bg-primary text-white hover:bg-primary/95"
                          }`}
                          disabled={step5Assigned && !isSandboxMode}
                          onClick={() => {
                            if (isSandboxMode) setStep5Assigned(!step5Assigned);
                          }}
                        >
                          {step5Assigned ? (
                            <span className="flex items-center gap-1">
                              <Check className="size-3" />
                              Assigned to Shift A
                            </span>
                          ) : (
                            "Assign to Operator"
                          )}
                        </Button>
                      </div>
                    </div>

                  </div>
                )}


                {/* 4. INTELLIGENCE TAB VIEW */}
                {currentScene.tab === "intelligence" && (
                  <div className="flex-1 flex flex-col gap-4">
                    
                    {/* Header */}
                    <div className="border-b border-slate-200 pb-3">
                      <h3 className="font-bold text-slate-900">Compliance & Regulatory Audits</h3>
                      <p className="text-[10px] text-slate-500">Continuous background compliance gap detection</p>
                    </div>

                    {/* Gap Card */}
                    <div className="border border-red-200 bg-red-50/50 rounded-xl p-4 shadow-sm space-y-3">
                      <div className="flex items-center gap-2 text-rose-805">
                        <AlertTriangle className="size-4 shrink-0 text-red-650" />
                        <span className="font-black text-[10px] uppercase tracking-wider">Critical Compliance Alert (Pump P-204)</span>
                      </div>
                      
                      <div className="space-y-1.5 text-[9px] text-slate-700">
                        <p className="font-extrabold text-[10px] text-slate-900">
                          Detected Gap: Missing Post-Maintenance Baseline Vibration Validation
                        </p>
                        <p className="leading-relaxed">
                          Following the corrective maintenance work-order (<strong>WO-99210</strong>) signed off on <strong>2025-03-20</strong>, the system failed to detect any uploaded post-repair vibration baseline spectrum record.
                        </p>
                        <p className="text-[8px] bg-white border border-red-200 p-2 rounded font-mono leading-normal text-rose-900">
                          <strong>Standard Violation:</strong> OSHA 29 CFR 1910.147 Sec (c)(6) & Site Safety Isolation Standard EIS-04: &quot;Energy isolation and repair operations must conclude with a verified operational baseline prior to resuming standard automated sequence.&quot;
                        </p>
                      </div>

                      <div className="flex justify-between items-center pt-1 border-t border-red-105">
                        <span className="text-[8px] font-mono text-slate-400">Risk Assessment: MEDIUM CRITICALITY</span>
                        <Button size="xs" variant="outline" className="text-[8px] font-bold border-red-300 text-red-800 hover:bg-red-50 rounded">
                          Create Rectification Task
                        </Button>
                      </div>
                    </div>

                  </div>
                )}


                {/* 5. ADMINISTRATION TAB VIEW */}
                {currentScene.tab === "administration" && (
                  <div className="flex-1 flex flex-col gap-4">
                    
                    {/* Header */}
                    <div className="border-b border-slate-200 pb-3">
                      <h3 className="font-bold text-slate-900">System Diagnostics & Evaluation</h3>
                      <p className="text-[10px] text-slate-500">Benchmark grounding tests and business metrics</p>
                    </div>

                    {/* Score summary panel */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded border border-slate-200 bg-white p-2.5 shadow-sm text-center">
                        <p className="text-[8px] font-bold text-slate-400 uppercase">Golden Test Score</p>
                        <p className="text-xl font-extrabold text-primary mt-1">98.4%</p>
                        <p className="text-[7.5px] text-slate-500 mt-0.5">Accurate Grounding</p>
                      </div>
                      <div className="rounded border border-slate-200 bg-white p-2.5 shadow-sm text-center">
                        <p className="text-[8px] font-bold text-slate-400 uppercase">Citation Match</p>
                        <p className="text-xl font-extrabold text-emerald-600 mt-1">100%</p>
                        <p className="text-[7.5px] text-slate-500 mt-0.5">Citations Resolved</p>
                      </div>
                      <div className="rounded border border-slate-200 bg-white p-2.5 shadow-sm text-center">
                        <p className="text-[8px] font-bold text-slate-400 uppercase">Hallucinations</p>
                        <p className="text-xl font-extrabold text-slate-800 mt-1">0%</p>
                        <p className="text-[7.5px] text-slate-500 mt-0.5">Factual Violations</p>
                      </div>
                    </div>

                    {/* Operational Impact report */}
                    <Card className="border border-slate-200 shadow-sm rounded-lg overflow-hidden">
                      <div className="bg-slate-50 px-3 py-1.5 border-b border-slate-150 text-[8.5px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1">
                        <BarChart3 className="size-3.5 text-primary" />
                        Expected Operational Impact (Q1 Dahej Plant)
                      </div>
                      <CardContent className="p-3 text-[9px] space-y-2">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-1">
                          <span className="text-slate-600">Avoided Unplanned Downtime:</span>
                          <span className="font-bold text-slate-900">48 Hours</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-slate-100 pb-1">
                          <span className="text-slate-600">MTTR Response Time Reduction:</span>
                          <span className="font-bold text-slate-900">35 Minutes (Avg)</span>
                        </div>
                        <div className="flex justify-between items-center pb-1">
                          <span className="text-slate-600">Safety Compliance Gaps Cleared:</span>
                          <span className="font-bold text-emerald-600">1 Major Breach Prevented</span>
                        </div>
                        
                        <div className="bg-slate-50 p-2 border border-slate-200 rounded text-[7.5px] leading-relaxed text-slate-500">
                          *Calculated based on actual vector indexes and Neo4j node clusters matching production models.
                        </div>
                      </CardContent>
                    </Card>

                  </div>
                )}

              </main>

            </div>
          </div>

          {/* Timeline & Playback Controller */}
          <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex flex-col gap-3">
            {/* Progress Bar */}
            <div className="w-full flex items-center gap-3">
              <span className="text-[10px] font-mono font-bold text-slate-400 shrink-0">Progress</span>
              <div className="flex-1 bg-slate-150 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-primary h-full transition-all duration-500 rounded-full" 
                  style={{ width: `${progressPercent}%` }} 
                />
              </div>
              <span className="text-[10px] font-mono font-bold text-primary shrink-0">{progressPercent}%</span>
            </div>

            {/* Playback Button Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <Button 
                  size="icon" 
                  variant="outline" 
                  className="size-8.5 rounded-lg border-slate-200 hover:bg-slate-50 shrink-0" 
                  onClick={handlePrev}
                >
                  <ChevronLeft className="size-4 text-slate-600" />
                </Button>
                
                <Button 
                  size="sm" 
                  className={`text-xs font-bold rounded-lg px-4 h-8.5 cursor-pointer shrink-0 ${isPlaying ? "bg-amber-600 hover:bg-amber-650" : "bg-primary text-white hover:bg-primary/95"}`}
                  onClick={() => setIsPlaying(!isPlaying)}
                  disabled={isSandboxMode}
                >
                  {isPlaying ? (
                    <>
                      <Pause className="size-3.5 mr-1 text-white fill-current" />
                      Pause Tour
                    </>
                  ) : (
                    <>
                      <Play className="size-3.5 mr-1 text-white fill-current" />
                      Play Demo Tour
                    </>
                  )}
                </Button>

                <Button 
                  size="icon" 
                  variant="outline" 
                  className="size-8.5 rounded-lg border-slate-200 hover:bg-slate-50 shrink-0" 
                  onClick={handleNext}
                >
                  <ChevronRight className="size-4 text-slate-600" />
                </Button>

                <Button 
                  size="icon" 
                  variant="ghost" 
                  className="size-8.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 shrink-0" 
                  onClick={handleReset}
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              </div>

              <div className="text-[11px] font-bold font-mono text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                SCENE {currentSceneIdx + 1}/{scenes.length} • SUBSTEP {currentSubStepIdx + 1}/{currentScene.substeps.length}
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

// Sub-component for virtual sidebar buttons
function VirtualTabBtn({ active, label, icon }: { active: boolean; label: string; icon: React.ReactNode }) {
  return (
    <div
      className={`flex items-center gap-2.5 px-2 py-1.5 rounded text-[10px] font-bold transition-all ${
        active 
          ? "bg-primary text-primary-foreground font-black" 
          : "text-slate-500 hover:bg-slate-100"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </div>
  );
}
