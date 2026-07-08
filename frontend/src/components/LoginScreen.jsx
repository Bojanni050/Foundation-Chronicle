import { useState, useEffect } from "react";
import { Shield, KeyRound, Sparkles, User, Delete, ArrowRight } from "lucide-react";

export function LoginScreen({ onSuccess }) {
  const [hasAccount, setHasAccount] = useState(false);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  
  // Setup fields
  const [setupUsername, setSetupUsername] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  
  const [shake, setShake] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const storedPin = localStorage.getItem("chronicle_pin");
    const storedUser = localStorage.getItem("chronicle_username");
    if (storedPin) {
      setHasAccount(true);
      setUsername(storedUser || "Owner");
    }
  }, []);

  // Keyboard binding for entering PIN on login
  useEffect(() => {
    if (!hasAccount) return;
    const onKey = (e) => {
      if (e.key >= "0" && e.key <= "9") {
        handlePressNumber(e.key);
      } else if (e.key === "Backspace") {
        handleBackspace();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccount, pin]);

  const handlePressNumber = (num) => {
    const storedPin = localStorage.getItem("chronicle_pin") || "";
    const maxLen = storedPin.length || 4;
    if (pin.length >= maxLen) return;
    
    const nextPin = pin + num;
    setPin(nextPin);
    
    // Auto-check when reaching full length
    if (nextPin.length === maxLen) {
      if (nextPin === storedPin) {
        onSuccess();
      } else {
        triggerFail();
      }
    }
  };

  const handleBackspace = () => {
    setPin((p) => p.slice(0, -1));
  };

  const triggerFail = () => {
    setShake(true);
    setMsg("Incorrect PIN. Please try again.");
    setTimeout(() => {
      setPin("");
      setShake(false);
    }, 400);
  };

  const handleSetup = (e) => {
    e.preventDefault();
    setMsg("");
    
    if (!setupUsername.trim()) {
      setMsg("Please enter a username.");
      return;
    }
    if (setupPin.length < 4 || setupPin.length > 6) {
      setMsg("PIN must be 4 to 6 digits.");
      return;
    }
    if (setupPin !== setupConfirm) {
      setMsg("PIN codes do not match.");
      return;
    }

    localStorage.setItem("chronicle_pin", setupPin);
    localStorage.setItem("chronicle_username", setupUsername.trim());
    onSuccess();
  };

  if (!hasAccount) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background warm-blob">
        <div className="w-[380px] rounded-2xl border border-border/80 bg-card/75 backdrop-blur-md p-6 shadow-xl space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles className="h-6 w-6" strokeWidth={1.75} />
            </div>
            <h2 className="font-serif text-xl font-bold text-ink">Set up Chronicle</h2>
            <p className="text-xs text-muted-foreground">Create your local profile and secure it with a PIN lock.</p>
          </div>

          <form onSubmit={handleSetup} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Username</label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3">
                <User className="w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="e.g. Bojan"
                  value={setupUsername}
                  onChange={(e) => setSetupUsername(e.target.value)}
                  className="w-full bg-transparent py-2 text-sm text-ink focus:outline-none placeholder:text-muted-foreground/30"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Choose PIN (4-6 digits)</label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3">
                <KeyRound className="w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  maxLength={6}
                  placeholder="••••"
                  value={setupPin}
                  onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full bg-transparent py-2 text-sm text-ink focus:outline-none tracking-widest placeholder:text-muted-foreground/30"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Confirm PIN</label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3">
                <KeyRound className="w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  maxLength={6}
                  placeholder="••••"
                  value={setupConfirm}
                  onChange={(e) => setSetupConfirm(e.target.value.replace(/\D/g, ""))}
                  className="w-full bg-transparent py-2 text-sm text-ink focus:outline-none tracking-widest placeholder:text-muted-foreground/30"
                />
              </div>
            </div>

            {msg && <p className="text-xs text-destructive">{msg}</p>}

            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-semibold text-background hover:bg-ink/90 transition-colors"
            >
              Start Chronicle
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  const storedPin = localStorage.getItem("chronicle_pin") || "";
  const maxLen = storedPin.length || 4;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background warm-blob">
      <div className={`w-[340px] flex flex-col items-center space-y-6 p-6 rounded-2xl border border-border/80 bg-card/75 backdrop-blur-md shadow-xl transition-transform ${shake ? "animate-shake" : ""}`}>
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-primary">
            <Shield className="h-5 w-5" strokeWidth={2} />
          </div>
          <h2 className="font-serif text-lg font-bold text-ink">Unlock Chronicle</h2>
          <p className="text-xs text-muted-foreground">Welcome back, <span className="font-semibold text-ink">{username}</span></p>
        </div>

        {/* PIN Indicators */}
        <div className="flex items-center justify-center gap-4 py-2">
          {Array.from({ length: maxLen }).map((_, i) => (
            <div
              key={i}
              className={`h-3 w-3 rounded-full border border-primary transition-all duration-150 ${
                i < pin.length ? "bg-primary scale-110" : "bg-transparent"
              }`}
            />
          ))}
        </div>

        {/* Error message */}
        {msg && <p className="text-xs text-destructive text-center h-4">{msg}</p>}

        {/* Interactive Numpad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[240px]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handlePressNumber(String(num))}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-background/40 font-semibold text-ink text-lg hover:bg-accent/30 hover:border-primary/30 transition-all active:scale-95"
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => {
              localStorage.removeItem("chronicle_pin");
              localStorage.removeItem("chronicle_username");
              setHasAccount(false);
              setPin("");
              setMsg("");
            }}
            className="flex h-12 w-12 items-center justify-center rounded-full text-xs font-semibold text-muted-foreground hover:text-destructive transition-colors active:scale-95"
            title="Reset profile"
          >
            Reset
          </button>
          <button
            onClick={() => handlePressNumber("0")}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-background/40 font-semibold text-ink text-lg hover:bg-accent/30 hover:border-primary/30 transition-all active:scale-95"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="flex h-12 w-12 items-center justify-center rounded-full text-muted-foreground hover:text-ink transition-colors active:scale-95"
            title="Delete"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
