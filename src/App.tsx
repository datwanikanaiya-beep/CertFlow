import React, { useState, useEffect } from 'react';
import { ShieldCheck, PlusCircle, RefreshCw, AlertTriangle, Shield, CheckCircle, Globe, Copy, Check, Download, Zap, Key, Lock, AlertCircle, Loader2, User, LogOut, Mail, UserPlus, LogIn } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';

interface UserInfo {
  id: string;
  username: string;
}

interface CertMeta {
  domains: string[];
  maintainerEmail: string;
  issuedAt: string;
  expiresAt: string;
  issuer?: string;
}

interface DnsChallenge {
  token: string;
  domain: string;
  recordName: string;
  recordValue: string;
}

interface CertJob {
  id: string;
  domains: string[];
  status: 'processing' | 'waiting_dns' | 'completed' | 'error';
  error?: string;
}

export default function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authLoading, setAuthLoading] = useState(true);
  
  const [certs, setCerts] = useState<CertMeta[]>([]);
  const [challenges, setChallenges] = useState<DnsChallenge[]>([]);
  const [jobs, setJobs] = useState<CertJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Form state
  const [domains, setDomains] = useState('');
  const [email, setEmail] = useState('');
  const [useProduction, setUseProduction] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Auth Form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } catch (err) {
      console.error("Auth check failed", err);
    } finally {
      setAuthLoading(false);
    }
  };

  const fetchCerts = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch('/api/certs');
      if (res.status === 401) return setUser(null);
      const data = await res.json();
      if (data.certs) setCerts(data.certs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchChallenges = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/challenges/dns');
      if (res.status === 401) return setUser(null);
      const data = await res.json();
      if (data.challenges) setChallenges(data.challenges);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchJobs = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/jobs');
      if (res.status === 401) return setUser(null);
      const data = await res.json();
      if (data.jobs) {
        setJobs(data.jobs);
        if (data.jobs.some((j: CertJob) => j.status === 'completed')) {
          fetchCerts();
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDownload = async (domain: string, type: string) => {
    try {
      const response = await fetch(`/api/certs/download/${domain}/${type}`);
      if (!response.ok) {
        let errorMessage = 'Failed to download file';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          const text = await response.text();
          errorMessage = text || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${domain}.${type}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      alert(`Download failed: ${error.message}`);
    }
  };

  const handleEditCert = (cert: CertMeta) => {
    setDomains(cert.domains.join(', '));
    setEmail(cert.maintainerEmail);
    // If the issuer doesn't have "Staging", "Fake", etc., it is production.
    setUseProduction(cert.issuer ? !cert.issuer.toLowerCase().includes('staging') && !cert.issuer.toLowerCase().includes('fake') : false);
    
    // Scroll to the top of the page smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) {
      fetchCerts();
      fetchChallenges();
      fetchJobs();
      const interval = setInterval(() => {
        fetchChallenges();
        fetchJobs();
      }, 10000); // Poll every 10 seconds to reduce API load
      return () => clearInterval(interval);
    } else {
      setCerts([]);
      setChallenges([]);
      setJobs([]);
    }
  }, [user]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      
      if (authMode === 'login') {
        setUser(data);
      } else {
        setAuthMode('login');
        setAuthError(null);
        alert("Registration successful! Please log in.");
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setUsername('');
    setPassword('');
  };

  const handleVerify = async (token: string) => {
    setVerifying(token);
    try {
      const res = await fetch(`/api/challenges/dns/${token}/verify`, { method: 'POST' });
      if (res.status === 401) return setUser(null);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to verify DNS record");
      } else {
        setChallenges(c => c.filter(ch => ch.token !== token));
      }
    } catch (err) {
      console.error("Failed to verify", err);
      alert("Network error while verifying.");
    } finally {
      setVerifying(null);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    const domainList = domains.split(',').map(d => d.trim()).filter(Boolean);
    
    try {
      const res = await fetch('/api/certs/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: domainList, maintainerEmail: email, useProduction })
      });
      if (res.status === 401) return setUser(null);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to request cert');
      
      setSuccessMsg(data.message || `Background request started.`);
      setDomains('');
      fetchCerts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading && !user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-10 w-10 text-cyan-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30 overflow-x-hidden relative">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-900/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[120px]" />
      </div>

      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-[0_0_20px_rgba(6,182,212,0.3)] border border-white/10">
                <Lock className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 tracking-tight">CertFlow</h1>
                <p className="text-xs text-cyan-400/80 font-medium tracking-wide uppercase">Production Certificates</p>
              </div>
            </motion.div>
            
            <div className="flex items-center gap-6">
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="hidden md:flex items-center space-x-4">
                <span className="px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-sm text-slate-400 flex items-center gap-2 shadow-inner">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Let's Encrypt Node
                </span>
              </motion.div>

              {user && (
                <div className="flex items-center gap-4 pl-4 border-l border-white/10">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                    <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400">
                      <User className="h-4 w-4" />
                    </div>
                    {user.username}
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="p-2 hover:bg-red-500/10 text-slate-400 hover:text-red-400 rounded-lg transition-colors border border-transparent hover:border-red-500/20"
                    title="Log Out"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8 relative z-10">
        {!user ? (
          <div className="max-w-md mx-auto mt-20">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-900/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden relative">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-blue-500" />
              <div className="p-8">
                <div className="text-center mb-8">
                  <div className="inline-flex p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 mb-4">
                    {authMode === 'login' ? <LogIn className="h-8 w-8 text-cyan-400" /> : <UserPlus className="h-8 w-8 text-cyan-400" />}
                  </div>
                  <h2 className="text-2xl font-bold text-white">{authMode === 'login' ? 'Welcome Back' : 'Create Account'}</h2>
                  <p className="text-slate-400 text-sm mt-2">Access your SSL management dashboard</p>
                </div>

                <form onSubmit={handleAuth} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <User className="h-4 w-4" />
                      </div>
                      <input
                        type="text"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-950/50 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 text-slate-200 placeholder-slate-600 transition-all shadow-inner"
                        placeholder="Enter username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <Lock className="h-4 w-4" />
                      </div>
                      <input
                        type="password"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-950/50 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 text-slate-200 placeholder-slate-600 transition-all shadow-inner"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {authError && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3.5 rounded-xl text-sm flex gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <p>{authError}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full flex justify-center items-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 focus:ring-offset-slate-900 disabled:opacity-50 transition-all shadow-lg"
                  >
                    {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {authMode === 'login' ? 'Sign In' : 'Create Account'}
                  </button>

                  <div className="text-center pt-4 border-t border-white/5 mt-6">
                    <button 
                      type="button" 
                      onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(null); }}
                      className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                      {authMode === 'login' ? "Don't have an account? Register" : "Already have an account? Log In"}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        ) : (
          <>
            {/* DNS Challenges Banner */}
            <AnimatePresence>
              {challenges.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-amber-950/30 border border-amber-500/30 rounded-2xl overflow-hidden backdrop-blur-md shadow-[0_0_30px_rgba(245,158,11,0.1)]"
                >
                  <div className="px-6 py-4 border-b border-amber-500/20 bg-amber-500/10 flex items-center justify-between">
                    <h2 className="text-lg font-medium text-amber-400 flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5" />
                      Action Required: Pending DNS Challenges
                    </h2>
                  </div>
                  <div className="p-0">
                    <ul className="divide-y divide-amber-500/10">
                      {challenges.map((c) => (
                        <li key={c.token} className="p-6">
                          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                            <div className="flex-1">
                              <h3 className="text-md font-semibold text-amber-100 mb-3">Create TXT Record for {c.domain}</h3>
                              <div className="bg-slate-950/50 rounded-xl p-4 flex flex-col gap-3 font-mono text-sm border border-amber-500/20">
                                <div className="flex justify-between items-center bg-slate-900/80 border border-slate-700/50 px-4 py-2.5 rounded-lg group hover:border-amber-500/30 transition-colors">
                                  <span className="text-slate-500 font-sans text-xs w-20">Name</span>
                                  <span className="flex-1 overflow-auto mx-2 text-slate-300">{c.recordName}</span>
                                  <button onClick={() => copyToClipboard(c.recordName, `name-${c.token}`)} className="text-slate-400 hover:text-white p-1 transition-colors">
                                    {copied === `name-${c.token}` ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                                  </button>
                                </div>
                                <div className="flex justify-between items-center bg-slate-900/80 border border-slate-700/50 px-4 py-2.5 rounded-lg group hover:border-amber-500/30 transition-colors">
                                  <span className="text-slate-500 font-sans text-xs w-20">Value</span>
                                  <span className="flex-1 overflow-auto mx-2 text-slate-300">{c.recordValue}</span>
                                  <button onClick={() => copyToClipboard(c.recordValue, `val-${c.token}`)} className="text-slate-400 hover:text-white p-1 transition-colors">
                                    {copied === `val-${c.token}` ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                                  </button>
                                </div>
                              </div>
                              <p className="text-xs text-amber-500/70 mt-3 flex items-center gap-1.5">
                                <AlertCircle className="h-3.5 w-3.5" />
                                Wait up to 60 seconds after creating the record for propagation.
                              </p>
                            </div>
                            <div className="pt-2 md:pt-0 shrink-0 self-center">
                              <button
                                onClick={() => handleVerify(c.token)}
                                disabled={verifying === c.token}
                                className="px-6 py-3 rounded-xl text-sm font-semibold text-amber-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 focus:ring-offset-slate-950 disabled:opacity-50 transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.3)] hover:shadow-[0_0_25px_rgba(245,158,11,0.5)]"
                              >
                                {verifying === c.token ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
                                Verify Record
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Request Form */}
              <div className="lg:col-span-5 xl:col-span-4">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-900/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl overflow-hidden relative">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-blue-500" />
                  <div className="px-6 py-5 border-b border-white/5 bg-slate-900/50">
                    <h2 className="text-lg font-medium text-white flex items-center gap-2">
                      <Zap className="h-5 w-5 text-cyan-400" />
                      New Certificate
                    </h2>
                  </div>
                  <div className="p-6">
                    <form onSubmit={handleRequest} className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">Domains</label>
                        <input
                          type="text"
                          className="w-full px-4 py-2.5 bg-slate-950/50 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 text-slate-200 placeholder-slate-600 transition-all shadow-inner"
                          placeholder="example.com, www.example.com"
                          value={domains}
                          onChange={(e) => setDomains(e.target.value)}
                          required
                        />
                        <p className="mt-2 text-xs text-slate-500">First domain becomes the Common Name (CN).</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">Email (Recovery & Notices)</label>
                        <input
                          type="email"
                          className="w-full px-4 py-2.5 bg-slate-950/50 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 text-slate-200 placeholder-slate-600 transition-all shadow-inner"
                          placeholder="admin@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                      </div>

                      <div className="pt-2 pb-1">
                        <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-700/50 bg-slate-900/50 cursor-pointer hover:bg-slate-800/50 transition-colors group">
                          <div className="relative flex items-center justify-center">
                            <input
                              type="checkbox"
                              className="peer sr-only"
                              checked={useProduction}
                              onChange={(e) => setUseProduction(e.target.checked)}
                            />
                            <div className="w-10 h-5 bg-slate-700 rounded-full peer-checked:bg-cyan-500 transition-colors"></div>
                            <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
                          </div>
                          <div className="flex-1">
                            <span className="block text-sm font-medium text-slate-200">Production Mode</span>
                            <span className="block text-xs text-slate-500 mt-0.5">Staging (fake) certs if disabled.</span>
                          </div>
                        </label>
                      </div>
                      
                      <AnimatePresence>
                        {error && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3.5 rounded-xl text-sm mt-4 flex gap-2">
                              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                              <p>{error}</p>
                            </div>
                          </motion.div>
                        )}
                        {successMsg && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3.5 rounded-xl text-sm mt-4 flex gap-2 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                              <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                              <p>{successMsg}</p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full flex justify-center items-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(6,182,212,0.2)] hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] transition-all mt-4"
                      >
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin"/> : <Lock className="h-4 w-4"/>}
                        {isSubmitting ? 'Initiating...' : 'Generate Certificate'}
                      </button>
                    </form>
                  </div>
                </motion.div>
              </div>

              {/* Stored Certs & Jobs */}
              <div className="lg:col-span-7 xl:col-span-8 space-y-6">
                <AnimatePresence>
                  {jobs.length > 0 && jobs.some(j => j.status !== 'completed') && (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-slate-900/40 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
                      <div className="px-6 py-4 border-b border-white/5 bg-slate-900/50 flex justify-between items-center">
                        <h2 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                          <Loader2 className="h-4 w-4 text-cyan-400 animate-spin" />
                          Active Operations
                        </h2>
                      </div>
                      <div className="p-0">
                        <ul className="divide-y divide-white/5">
                          {jobs.filter(job => job.status !== 'completed').map((job) => (
                            <li key={job.id} className="p-5">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-white">{job.domains.join(', ')}</p>
                                  <div className="flex items-center gap-2 mt-2">
                                    {job.status === 'error' ? (
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 text-xs font-medium border border-red-500/20">
                                        <AlertTriangle className="h-3.5 w-3.5" /> Error
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-500/10 text-cyan-400 text-xs font-medium border border-cyan-500/20">
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" /> {job.status.replace('_', ' ').toUpperCase()}
                                      </span>
                                    )}
                                  </div>
                                  {job.error && <p className="mt-2 text-xs text-red-400/80">{job.error}</p>}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-slate-900/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl overflow-hidden min-h-[400px] flex flex-col">
                  <div className="px-6 py-5 border-b border-white/5 bg-slate-900/50 flex justify-between items-center">
                    <h2 className="text-lg font-medium text-white flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-emerald-400" />
                      Managed Certificates
                    </h2>
                    <button onClick={fetchCerts} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-slate-400 hover:text-white border border-transparent hover:border-white/10" title="Refresh">
                      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
                    </button>
                  </div>
                  
                  <div className="p-0 flex-1 flex flex-col">
                    {loading && certs.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-500">
                        <Loader2 className="h-8 w-8 animate-spin text-cyan-500 mb-4" />
                        <p>Fetching certificates...</p>
                      </div>
                    ) : certs.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                        <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mb-4 border border-white/5 shadow-inner">
                          <Shield className="h-8 w-8 text-slate-600" />
                        </div>
                        <p className="text-slate-300 font-medium text-lg">No certificates found</p>
                        <p className="text-slate-500 text-sm mt-2 max-w-sm">Generate your first production SSL certificate using the panel on the left.</p>
                      </div>
                    ) : (
                      <ul className="divide-y divide-white/5">
                        {certs.map((cert) => {
                           const expiresAt = new Date(cert.expiresAt);
                           const daysLeft = Math.round((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                           const isExpiringSoon = daysLeft <= 30;
                           const primaryDomain = cert.domains[0];

                           return (
                            <li key={primaryDomain} className="p-6 hover:bg-white/[0.02] transition-colors group">
                              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
                                <div className="flex-1">
                                  <div className="flex items-center gap-3 mb-2">
                                    <h3 className="text-xl font-bold text-white tracking-tight">{primaryDomain}</h3>
                                    {cert.domains.length > 1 && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                                        +{cert.domains.length - 1} SANs
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-slate-400 truncate max-w-lg flex items-center gap-2">
                                    <Globe className="h-3.5 w-3.5" />
                                    {cert.domains.join(', ')}
                                  </p>
                                  <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                                    <span className="flex items-center gap-1"><Shield className="h-3.5 w-3.5"/> {cert.issuer || "Staging Issuer"}</span>
                                    <span className="flex items-center gap-1">Maintainer: {cert.maintainerEmail}</span>
                                  </div>
                                </div>
                                
                                <div className="flex flex-col items-start xl:items-end gap-3 shrink-0">
                                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border shadow-sm ${
                                    isExpiringSoon 
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.1)]' 
                                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                                  }`}>
                                    {isExpiringSoon ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                                    Expires {formatDistanceToNow(expiresAt, { addSuffix: true })}
                                  </div>
                                  <button onClick={() => handleEditCert(cert)} className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 hover:border-indigo-500/40 rounded-lg text-sm font-medium transition-all shadow-sm">
                                    <RefreshCw className="h-4 w-4" /> Edit / Renew
                                  </button>
                                </div>
                              </div>
                              
                              <div className="mt-6 pt-5 border-t border-white/5 flex flex-wrap items-center gap-3 opacity-80 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleDownload(primaryDomain, 'cert')} className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 rounded-lg text-sm font-medium transition-all shadow-sm">
                                  <Download className="h-4 w-4 text-cyan-400" /> Certificate (.cert)
                                </button>
                                <button onClick={() => handleDownload(primaryDomain, 'chain')} className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 rounded-lg text-sm font-medium transition-all shadow-sm">
                                  <Download className="h-4 w-4 text-cyan-400" /> Chain (.chain)
                                </button>
                                <button onClick={() => handleDownload(primaryDomain, 'fullchain')} className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 rounded-lg text-sm font-medium transition-all shadow-sm" title="Certificate + Intermediate Chain">
                                  <Download className="h-4 w-4 text-cyan-400" /> Full Chain (.pem)
                                </button>
                                <button onClick={() => handleDownload(primaryDomain, 'key')} className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 rounded-lg text-sm font-medium transition-all shadow-sm">
                                  <Key className="h-4 w-4 text-cyan-400" /> Private Key (.key)
                                </button>
                              </div>
                            </li>
                           );
                        })}
                      </ul>
                    )}
                  </div>
                </motion.div>
              </div>

            </div>
          </>
        )}
      </main>
    </div>
  );
}
