import React, { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Play, Pause, Mic, Music2, Volume2, Radio, Settings, Zap, ListMusic, Activity, Waves, Sparkles, Airplay, ChevronDown, History, SunMoon } from "lucide-react";

// --- shadcn/ui style components ---
const Button = ({ className = "", variant = "default", size = "md", ...props }) => (
  <button
    className={
      `inline-flex items-center gap-2 rounded-2xl px-4 py-2 shadow-sm transition-all ` +
      (variant === "outline"
        ? "border border-gray-300 hover:bg-gray-50 "
        : variant === "ghost"
        ? "hover:bg-gray-100 "
        : "bg-black text-white hover:bg-gray-900 ") +
      (size === "sm" ? " text-sm px-3 py-1.5 " : size === "lg" ? " text-base px-5 py-2.5 " : " ") +
      className
    }
    {...props}
  />
);

const Card = ({ className = "", ...props }) => (
  <div className={`rounded-2xl shadow-sm ${className}`} {...props} />
);
const CardHeader = ({ className = "", ...props }) => (
  <div className={`p-4 border-b border-gray-100 ${className}`} {...props} />
);
const CardTitle = ({ className = "", ...props }) => (
  <h3 className={`font-semibold ${className}`} {...props} />
);
const CardContent = ({ className = "", ...props }) => (
  <div className={`p-4 ${className}`} {...props} />
);

const Chip = ({ children, color = "gray" }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ` +
    (color === "green" ? "bg-green-50 text-green-700 border-green-200" :
     color === "red" ? "bg-rose-50 text-rose-700 border-rose-200" :
     color === "amber" ? "bg-amber-50 text-amber-700 border-amber-200" :
     color === "purple" ? "bg-purple-50 text-purple-700 border-purple-200" :
     "bg-gray-50 text-gray-700 border-gray-200")
  }>{children}</span>
);

const Select = ({ value, onChange, options }) => (
  <div className="relative">
    <select
      className="appearance-none w-full rounded-xl border border-gray-300 bg-white px-4 py-2 pr-9 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-black/10"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-gray-500" />
  </div>
);

const Slider = ({ value, onChange, min = 0, max = 100 }) => (
  <input type="range" min={min} max={max} value={value} onChange={(e)=>onChange(Number(e.target.value))} className="w-full accent-black" />
);

// --- Mock data ---
const SCENES = [
  { key: "BATTLE", label: "Battle", color: "red", icon: Zap },
  { key: "TAVERN", label: "Tavern", color: "amber", icon: ListMusic },
  { key: "EXPLORATION", label: "Exploration", color: "green", icon: Activity },
  { key: "TENSION", label: "Tension", color: "purple", icon: Waves },
  { key: "REST", label: "Rest", color: "gray", icon: Sparkles }
];

const GENRES = [
  { value: "fantasy", label: "Fantasy" },
  { value: "cyberpunk", label: "Cyberpunk" },
  { value: "scifi", label: "Sci-Fi" },
  { value: "modern", label: "Modern" },
  { value: "horror", label: "Horror" }
];

// Genre palettes for background + cards + buttons
const genreThemes = {
  fantasy: {
    background: "from-green-100 via-emerald-200 to-green-300",
    card: "bg-green-50 border-green-200",
    button: "bg-emerald-100 text-emerald-800 border-emerald-200"
  },
  cyberpunk: {
    background: "from-fuchsia-100 via-purple-200 to-cyan-200",
    card: "bg-fuchsia-50 border-fuchsia-200",
    button: "bg-purple-100 text-purple-800 border-purple-200"
  },
  scifi: {
    background: "from-sky-100 via-indigo-200 to-violet-200",
    card: "bg-sky-50 border-sky-200",
    button: "bg-indigo-100 text-indigo-800 border-indigo-200"
  },
  modern: {
    background: "from-gray-50 via-gray-200 to-gray-300",
    card: "bg-gray-50 border-gray-200",
    button: "bg-gray-100 text-gray-800 border-gray-200"
  },
  horror: {
    background: "from-rose-100 via-red-200 to-gray-300",
    card: "bg-rose-50 border-rose-200",
    button: "bg-red-100 text-red-800 border-red-200"
  }
};

const demoCandidates = {
  BATTLE: [
    { id: "yt1", title: "Epic Battle Drums", provider: "YouTube", length: "3:21" },
    { id: "px1", title: "Clash of Steel", provider: "Pixabay", length: "2:58" }
  ],
  TAVERN: [
    { id: "yt2", title: "Lute at the Inn", provider: "YouTube", length: "4:10" },
    { id: "px2", title: "Folk Dance", provider: "Pixabay", length: "3:05" }
  ],
  EXPLORATION: [
    { id: "yt3", title: "Ruins Ambient", provider: "YouTube", length: "5:01" }
  ],
  TENSION: [
    { id: "yt4", title: "Dark Pulse", provider: "YouTube", length: "2:44" }
  ],
  REST: [
    { id: "yt5", title: "Campfire Night", provider: "YouTube", length: "6:12" }
  ]
};

function MicVisualizer({ active }) {
  const bars = new Array(18).fill(0);
  return (
    <div className="flex items-end gap-1 h-10">
      {bars.map((_, i) => (
        <motion.div
          key={i}
          animate={{ height: active ? Math.max(4, Math.random() * 40) : 4 }}
          transition={{ duration: 0.25 }}
          className="w-1 rounded bg-gray-300"
        />
      ))}
    </div>
  );
}

export default function AutoDJMock() {
  const [listening, setListening] = useState(true);
  const [genre, setGenre] = useState("fantasy");
  const [scene, setScene] = useState("TAVERN");
  const [volume, setVolume] = useState(70);
  const [crossfade, setCrossfade] = useState(5);
  const [dark, setDark] = useState(false);

  const CurrentIcon = useMemo(() => SCENES.find(s=>s.key===scene)?.icon ?? Music2, [scene]);
  const theme = genreThemes[genre];

  useEffect(()=>{
    if (dark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  },[dark]);

  return (
    <div className={`min-h-screen bg-gradient-to-b ${theme.background} text-gray-900`}>
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b border-gray-200/60">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5" />
            <span className="font-semibold">RPG Auto‑DJ</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" className="hidden sm:inline-flex" onClick={()=>setDark(v=>!v)}>
              <SunMoon className="h-4 w-4" /> Theme
            </Button>
            <Button variant="outline"><Settings className="h-4 w-4" /> Settings</Button>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <section className="lg:col-span-1 space-y-6">
          <Card className={theme.card}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Mic className="h-4 w-4"/> Live Input</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {listening ? <Chip color="green">Listening</Chip> : <Chip color="red">Paused</Chip>}
                </div>
                <Button onClick={()=>setListening(v=>!v)}>{listening ? <><Pause className="h-4 w-4"/> Pause</> : <><Play className="h-4 w-4"/> Listen</>}</Button>
              </div>
              <div className="rounded-xl border p-3 bg-white/60">
                <MicVisualizer active={listening} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3">
                  <label className="text-xs font-medium text-gray-600">Genre</label>
                  <Select value={genre} onChange={setGenre} options={GENRES} />
                </div>
                <div className="col-span-3">
                  <label className="text-xs font-medium text-gray-600">Volume ({volume}%)</label>
                  <Slider value={volume} onChange={setVolume} />
                </div>
                <div className="col-span-3">
                  <label className="text-xs font-medium text-gray-600">Crossfade ({crossfade}s)</label>
                  <Slider value={crossfade} onChange={setCrossfade} max={12} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={theme.card}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Settings className="h-4 w-4"/> Manual Override</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {SCENES.map(s=> (
                <Button
                  key={s.key}
                  variant={scene===s.key?"default":"outline"}
                  onClick={()=>setScene(s.key)}
                  className={`rounded-full ${theme.button}`}
                >
                  <s.icon className="h-4 w-4"/> {s.label}
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card className={theme.card}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><History className="h-4 w-4"/> Recent Transcript</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-gray-700 max-h-48 overflow-auto">
                <p>…захожу в трактир, ищу стол у окна…</p>
                <p>…тихо, слышно лишь лютню…</p>
                <p>…ох, кажется, кто-то наблюдает за нами…</p>
                <p>…внимание, ловушка справа!…</p>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Right column */}
        <section className="lg:col-span-2 space-y-6">
          <Card className={theme.card + " overflow-hidden"}>
            <CardContent className="p-0">
              <div className="flex flex-col md:flex-row">
                <div className="md:w-1/2 p-6 flex flex-col justify-center gap-4 text-white bg-black/60">
                  <div className="flex items-center gap-2">
                    <Chip color="amber">Genre: {genre}</Chip>
                  </div>
                  <div className="flex items-center gap-3">
                    <CurrentIcon className="h-8 w-8" />
                    <div>
                      <div className="text-sm text-white/70">Current Scene</div>
                      <div className="text-3xl font-semibold">{SCENES.find(s=>s.key===scene)?.label}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-white/80">
                    Confidence: 0.82 | Cooldown: 42s
                  </div>
                  <div className="flex items-center gap-3">
                    <Button variant="outline" className="bg-white/10 text-white border-white/20"><Airplay className="h-4 w-4"/> Cast</Button>
                    <Button className="bg-white text-gray-900"><Play className="h-4 w-4"/> Play</Button>
                  </div>
                </div>

                <div className="md:w-1/2 p-6 bg-white/70">
                  <div className="flex items-center gap-3 mb-3">
                    <Music2 className="h-5 w-5 text-gray-600"/>
                    <div>
                      <div className="text-xs text-gray-500">Now Playing</div>
                      <div className="font-medium">Lute at the Inn</div>
                      <div className="text-xs text-gray-500">YouTube • 4:10</div>
                    </div>
                  </div>
                  <div className="rounded-xl bg-gray-100 aspect-video flex items-center justify-center text-gray-500">
                    <span>Video / Cover Art</span>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Volume2 className="h-4 w-4 text-gray-600"/>
                    <Slider value={volume} onChange={setVolume} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={theme.card}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ListMusic className="h-4 w-4"/> Candidate Tracks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(demoCandidates[scene] || []).map((t)=> (
                  <div key={t.id} className="rounded-xl border overflow-hidden bg-white/70 group">
                    <div className="aspect-video bg-gray-100 flex items-center justify-center text-gray-500">Cover</div>
                    <div className="p-3">
                      <div className="font-medium line-clamp-1">{t.title}</div>
                      <div className="text-xs text-gray-500">{t.provider} • {t.length}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Button size="sm" className="rounded-full"><Play className="h-4 w-4"/> Play</Button>
                        <Button size="sm" variant="outline" className="rounded-full">Queue</Button>
                      </div>
                    </div>
                  </div>
                ))}
                {/* Empty state */}
                {(!demoCandidates[scene] || demoCandidates[scene].length === 0) && (
                  <div className="col-span-full text-sm text-gray-600">No candidates yet. Try switching scene or genre.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-4 pb-10 text-xs text-gray-700 text-center">
        <p>Mock UI — theme adapts by genre: Fantasy (green), Cyberpunk (neon), Sci‑Fi (blue‑violet), Modern (grays), Horror (dark red).</p>
      </footer>
    </div>
  );
}

/*
MANUAL TEST CASES
1) Build should succeed (syntax): previously missing closing ")}" after map; fixed by adding ")}" and completing all wrapping tags.
2) Scene buttons switch the highlighted scene and the candidates list updates accordingly.
3) Genre select changes background gradient and card/button tints calmly per genre.
4) Empty state: temporarily set demoCandidates["BATTLE"] = [] and verify "No candidates yet" appears.
5) Listen/Pause toggles visualizer animation (bars move when Listening).
*/