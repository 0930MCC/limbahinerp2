import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  User,
} from 'lucide-react';
import { ApiError, api } from '../lib/api.ts';
import { useFeedback } from '../lib/feedback.tsx';
import type { AccountLockReason, WorkerRecord } from '../shared/types.ts';

export interface AuthenticatedPayload {
  token: string;
  worker: WorkerRecord;
  emailConfirmed: boolean;
  lockReason: AccountLockReason;
  requiresReloginAfterUnlock?: boolean;
  previewConfirmToken?: string;
  resendCooldownSeconds?: number;
}

export interface PasswordRecoveryPayload {
  code?: string;
  tokenHash?: string;
  accessToken?: string;
  previewToken?: string;
}

interface AuthScreenProps {
  hasMaster: boolean;
  initialNotice?: string | null;
  initialError?: string | null;
  initialRecovery?: PasswordRecoveryPayload | null;
  onClearRecovery?: () => void;
  onAuthenticated: (payload: AuthenticatedPayload) => void;
}

function formatTimer(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function AuthScreen({
  hasMaster,
  initialNotice,
  initialError,
  initialRecovery,
  onClearRecovery,
  onAuthenticated,
}: AuthScreenProps) {
  const { notifyError, notifySuccess } = useFeedback();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>(
    initialRecovery ? 'reset' : hasMaster ? 'login' : 'signup'
  );
  const [recovery, setRecovery] = useState<PasswordRecoveryPayload | null>(
    initialRecovery || null
  );

  const [identifier, setIdentifier] = useState('');
  const [workerId, setWorkerId] = useState(hasMaster ? '' : 'MCC-1001');
  const [fullName, setFullName] = useState(hasMaster ? '' : 'PT. Limbahin Utama');
  const [username, setUsername] = useState(hasMaster ? '' : 'limbahinmcc');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Forgot password states
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotCooldown, setForgotCooldown] = useState(0);
  const [previewResetToken, setPreviewResetToken] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError || null);
  const [notice, setNotice] = useState<string | null>(initialNotice || null);

  useEffect(() => {
    if (initialRecovery) {
      setRecovery(initialRecovery);
      setMode('reset');
      setError(null);
      setNotice(null);
    }
  }, [initialRecovery]);

  useEffect(() => {
    if (forgotCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setForgotCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [forgotCooldown]);

  const switchMode = (next: 'login' | 'signup' | 'forgot' | 'reset') => {
    setMode(next);
    setError(null);
    setNotice(null);
    if (next === 'forgot' && !forgotIdentifier && identifier.trim()) {
      setForgotIdentifier(identifier.trim());
    }
    if (next !== 'reset') {
      setRecovery(null);
      onClearRecovery?.();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);

    try {
      if (mode === 'forgot') {
        const target = forgotIdentifier.trim();
        if (!target) {
          throw new Error('Please enter your username or email address.');
        }
        const res = await api.forgotPassword(target);
        setForgotCooldown(res.cooldownSeconds || 120);
        setPreviewResetToken(res.previewResetToken || null);
        setNotice(res.message);
        notifySuccess(res.message);
        return;
      }

      if (mode === 'reset') {
        if (password.length < 6) {
          throw new Error('New password must be at least 6 characters.');
        }
        if (password !== confirmPassword) {
          throw new Error('Password confirmation does not match.');
        }
        if (!recovery) {
          throw new Error('Reset link has expired. Please request a new password reset.');
        }
        const res = await api.resetPassword({
          ...recovery,
          newPassword: password,
        });
        setPassword('');
        setConfirmPassword('');
        setRecovery(null);
        setPreviewResetToken(null);
        onClearRecovery?.();
        setMode('login');
        setNotice(res.message);
        notifySuccess(res.message);
        return;
      }

      if (mode === 'signup') {
        if (!email.trim()) {
          throw new Error('Email address is required for office registration.');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        if (password !== confirmPassword) {
          throw new Error('Password confirmation does not match.');
        }

        const res = await api.signup({
          id: workerId.trim() || undefined,
          name: fullName.trim(),
          username: username.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || undefined,
        });

        if (!res?.token || !res?.worker) {
          throw new Error(
            'Unexpected response from registration service. Please try again.'
          );
        }

        notifySuccess(
          res.message || 'Office account created. Please confirm your email.'
        );
        onAuthenticated({
          token: res.token,
          worker: res.worker,
          emailConfirmed: Boolean(res.emailConfirmed),
          lockReason: res.lockReason ?? 'email_not_confirmed',
          requiresReloginAfterUnlock: Boolean(res.requiresReloginAfterUnlock),
          previewConfirmToken: res.previewConfirmToken,
          resendCooldownSeconds: res.resendCooldownSeconds,
        });
      } else {
        const session = await api.login(identifier.trim(), password, rememberMe);
        if (!session?.token || !session?.worker) {
          throw new Error('Unexpected sign-in response. Please try again.');
        }
        onAuthenticated({
          token: session.token,
          worker: session.worker,
          emailConfirmed: session.emailConfirmed ?? true,
          lockReason: session.lockReason ?? null,
          requiresReloginAfterUnlock: Boolean(session.requiresReloginAfterUnlock),
          previewConfirmToken: session.previewConfirmToken,
          resendCooldownSeconds: session.resendCooldownSeconds,
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.retryAfterSeconds && err.retryAfterSeconds > 0) {
        setForgotCooldown(err.retryAfterSeconds);
      }
      const msg = err instanceof Error ? err.message : 'Authentication failed.';
      setError(msg);
      notifyError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#F5F8F9] relative">
      {/* Left Brand Panel */}
      <aside className="lg:col-span-5 bg-[#0A4F55] text-white p-8 lg:p-14 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-white p-1.5 flex items-center justify-center shrink-0">
              <img
                src="/assets/aistudio/Logo_b14b4906.jpg"
                alt="LIMBAHIN logo"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
            </div>
            <span className="font-display text-xl font-extrabold tracking-wide text-[#5BC3D7]">
              LIMBAHIN
            </span>
          </div>

          <div className="mt-14 max-w-md space-y-4">
            <p className="text-sm font-medium text-teal-200 tracking-wide">
              Office ERP &amp; Operations
            </p>
            <h1 className="font-display text-3xl lg:text-4xl font-bold leading-tight text-white">
              Hazardous waste logistics, manifests, and billing in one ledger.
            </h1>
            <p className="text-sm leading-relaxed text-teal-100/90">
              Office sign-ups create a Master account in inactive status. You
              can sign in immediately; dashboard access remains locked until
              your email is confirmed and your worker status is activated in
              Supabase.
            </p>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/15 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="font-mono text-teal-200 text-xs">MCC &middot; CUST</p>
            <p className="mt-1 text-white/95 font-medium">
              Alphanumeric staff &amp; client IDs
            </p>
          </div>
          <div>
            <p className="font-mono text-teal-200 text-xs">ITM &middot; PO &middot; INV</p>
            <p className="mt-1 text-white/95 font-medium">
              Year-indexed sequential documents
            </p>
          </div>
        </div>
      </aside>

      {/* Right Auth Form */}
      <main className="lg:col-span-7 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8">
          {(mode === 'login' || mode === 'signup') && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-6">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  mode === 'signup'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Office Sign Up
              </button>
            </div>
          )}

          {(mode === 'forgot' || mode === 'reset') && (
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-teal-800 mb-5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Sign In
            </button>
          )}

          <div className="space-y-1.5 mb-6">
            <h2 className="font-display text-2xl font-bold text-slate-900">
              {mode === 'signup'
                ? 'Create Office Master Account'
                : mode === 'forgot'
                  ? 'Reset your password'
                  : mode === 'reset'
                    ? 'Set a new password'
                    : 'Sign in to LIMBAHIN Office'}
            </h2>
            <p className="text-sm text-slate-600">
              {mode === 'signup'
                ? 'Creates a Master worker with status inactive. Confirm your email and activate status in Supabase to unlock the dashboard.'
                : mode === 'forgot'
                  ? 'Enter your username or registered email address and we will send a password recovery link.'
                  : mode === 'reset'
                    ? 'Choose a new password (minimum 6 characters) for your LIMBAHIN Office account.'
                    : 'Sign in with your username or email. Unverified or inactive accounts enter in locked mode until confirmed and activated.'}
            </p>
          </div>

          {notice && (
            <div className="mb-4 px-3.5 py-2.5 rounded-lg bg-[#EFF8F8] border border-teal-200 text-xs text-teal-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-teal-700" />
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-4 px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'forgot' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Username or Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={forgotIdentifier}
                      onChange={(e) => setForgotIdentifier(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="limbahinmcc or name@mediacahayacerah.com"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || forgotCooldown > 0}
                  className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap"
                >
                  <KeyRound className="w-4 h-4" />
                  {submitting ? (
                    <span>Sending Reset Link...</span>
                  ) : forgotCooldown > 0 ? (
                    <span className="tabular-nums">
                      Resend Reset Link ({formatTimer(forgotCooldown)})
                    </span>
                  ) : (
                    <span>Send Password Reset Link</span>
                  )}
                </button>

                {previewResetToken && (
                  <button
                    type="button"
                    onClick={() => {
                      setRecovery({ previewToken: previewResetToken });
                      setMode('reset');
                      setError(null);
                      setNotice(null);
                    }}
                    className="w-full px-4 py-2 text-xs font-medium text-teal-800 bg-[#EFF8F8] border border-teal-200 hover:bg-teal-50 rounded-lg transition-colors"
                  >
                    Open Password Reset Form (Local Preview)
                  </button>
                )}
              </>
            )}

            {mode === 'reset' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      placeholder="Minimum 6 characters"
                      className="w-full pl-9 pr-10 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <ShieldCheck className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      placeholder="Re-enter new password"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
                >
                  <span>{submitting ? 'Updating Password...' : 'Update Password'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </>
            )}

            {mode === 'signup' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Worker ID{' '}
                      <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={workerId}
                      onChange={(e) => setWorkerId(e.target.value)}
                      placeholder={hasMaster ? 'Auto MCC-XXXXX' : 'MCC-1001'}
                      className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Role &amp; Initial Status
                    </label>
                    <input
                      type="text"
                      value="master · inactive"
                      disabled
                      className="w-full px-3 py-2 text-xs font-mono bg-slate-100 text-slate-600 border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Name / Organization
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    placeholder="PT. Limbahin Utama"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Username
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        autoComplete="username"
                        placeholder="limbahinmcc"
                        className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Phone <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+62 812..."
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Work Email <span className="text-red-600">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="name@company.co.id"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                    />
                  </div>
                </div>
              </>
            )}

            {mode === 'login' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Username or Email
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    autoComplete="username"
                    placeholder="limbahinmcc or name@company.co.id"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                  />
                </div>
              </div>
            )}

            {(mode === 'login' || mode === 'signup') && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete={
                        mode === 'signup' ? 'new-password' : 'current-password'
                      }
                      placeholder={
                        mode === 'signup' ? 'Minimum 6 characters' : 'Enter password'
                      }
                      className="w-full pl-9 pr-10 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  {mode === 'login' && (
                    <div className="mt-1.5 flex justify-end">
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
                        className="text-xs font-medium text-teal-700 hover:text-teal-900 hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                  )}
                </div>

                {mode === 'signup' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <ShieldCheck className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        placeholder="Re-enter password"
                        className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                      />
                    </div>
                  </div>
                )}

                {mode === 'login' && (
                  <label className="flex items-center gap-2.5 text-xs text-slate-600 cursor-pointer select-none pt-0.5">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600/30"
                    />
                    <span>Remember me on this browser (30 days)</span>
                  </label>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
                >
                  <span>
                    {submitting
                      ? mode === 'signup'
                        ? 'Creating Master Account...'
                        : 'Signing In...'
                      : mode === 'signup'
                        ? 'Sign Up Office Account'
                        : 'Sign In'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
