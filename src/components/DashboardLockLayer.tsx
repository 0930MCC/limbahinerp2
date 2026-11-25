import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { ApiError, api } from '../lib/api.ts';
import { useFeedback } from '../lib/feedback.tsx';
import type { AccountLockReason, WorkerRecord } from '../shared/types.ts';

interface DashboardLockLayerProps {
  worker: WorkerRecord;
  lockReason: AccountLockReason;
  emailConfirmed: boolean;
  requiresReloginAfterUnlock: boolean;
  previewConfirmToken?: string;
  initialResendCooldownSeconds?: number;
  onSessionUpdated: (update: {
    token?: string;
    worker: WorkerRecord;
    emailConfirmed: boolean;
    lockReason: AccountLockReason;
    requiresReloginAfterUnlock: boolean;
    previewConfirmToken?: string;
    resendCooldownSeconds?: number;
  }) => void;
  onSignOut: () => void;
}

function formatTimer(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function DashboardLockLayer({
  worker,
  lockReason,
  emailConfirmed,
  requiresReloginAfterUnlock,
  previewConfirmToken,
  initialResendCooldownSeconds = 0,
  onSessionUpdated,
  onSignOut,
}: DashboardLockLayerProps) {
  const { notifyError, notifySuccess } = useFeedback();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(
    Math.max(0, initialResendCooldownSeconds)
  );

  // Inline Change Email state (only when email_not_confirmed)
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState(worker.email || '');
  const [savingEmail, setSavingEmail] = useState(false);

  // Relogin-to-unlock password state
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  // Sync cooldown if server reports a higher value
  useEffect(() => {
    if (initialResendCooldownSeconds > 0) {
      setCooldownSeconds((prev) => Math.max(prev, initialResendCooldownSeconds));
    }
  }, [initialResendCooldownSeconds]);

  // 1-second countdown ticker for the 2-minute resend cooldown
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds]);

  const handleCheckStatus = async (silentOnPending = false) => {
    setChecking(true);
    try {
      const me = await api.me();
      if (typeof me.resendCooldownSeconds === 'number') {
        setCooldownSeconds(me.resendCooldownSeconds);
      }
      onSessionUpdated({
        worker: me.worker,
        emailConfirmed: me.emailConfirmed,
        lockReason: me.lockReason,
        requiresReloginAfterUnlock: Boolean(me.requiresReloginAfterUnlock),
        resendCooldownSeconds: me.resendCooldownSeconds,
      });

      if (me.lockReason === 'email_not_confirmed') {
        if (!silentOnPending) {
          notifyError(
            'Email is not confirmed yet. Open the verification link in your inbox, then check again.'
          );
        }
      } else if (me.lockReason === 'account_inactive') {
        setEditingEmail(false);
        if (!emailConfirmed && me.emailConfirmed) {
          notifySuccess(
            'Email confirmed! Waiting for status to be set to active in Supabase.'
          );
        } else {
          notifyError(
            'Account status is still inactive in Supabase (public.workers).'
          );
        }
      } else if (me.requiresReloginAfterUnlock) {
        setEditingEmail(false);
        notifySuccess(
          'Email confirmed and account active. Enter your password to unlock your session.'
        );
      } else {
        setEditingEmail(false);
        notifySuccess('Account verified and active. Dashboard unlocked.');
      }
    } catch {
      // Global feedback listener displays the error notification bar
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    if (!worker.email || cooldownSeconds > 0) return;
    setResending(true);
    try {
      const res = await api.resendConfirmation(worker.email);
      if (res.alreadyConfirmed) {
        notifySuccess(res.message);
        await handleCheckStatus(true);
        return;
      }
      setCooldownSeconds(res.cooldownSeconds || 120);
      notifySuccess(
        res.message || `Confirmation email re-sent to ${worker.email}.`
      );
    } catch (err) {
      if (err instanceof ApiError && err.retryAfterSeconds && err.retryAfterSeconds > 0) {
        setCooldownSeconds(err.retryAfterSeconds);
      }
    } finally {
      setResending(false);
    }
  };

  const handleChangeEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      notifyError('Please enter a valid email address.');
      return;
    }
    if (trimmed === (worker.email || '').trim().toLowerCase()) {
      notifyError('Enter a different email address than your current one.');
      return;
    }

    setSavingEmail(true);
    try {
      const res = await api.changeEmail(trimmed);
      setCooldownSeconds(res.cooldownSeconds || 120);
      setEditingEmail(false);
      setNewEmail(res.email);
      onSessionUpdated({
        worker: res.worker,
        emailConfirmed: false,
        lockReason: 'email_not_confirmed',
        requiresReloginAfterUnlock,
        previewConfirmToken: res.previewConfirmToken ?? previewConfirmToken,
        resendCooldownSeconds: res.cooldownSeconds || 120,
      });
      if (res.emailSent) {
        notifySuccess(res.message);
      } else {
        notifyError(res.message);
      }
    } catch (err) {
      if (err instanceof ApiError && err.retryAfterSeconds && err.retryAfterSeconds > 0) {
        setCooldownSeconds(err.retryAfterSeconds);
      }
    } finally {
      setSavingEmail(false);
    }
  };

  const handlePreviewConfirm = async () => {
    if (!previewConfirmToken) return;
    setChecking(true);
    try {
      const res = await api.confirmEmail({ previewToken: previewConfirmToken });
      onSessionUpdated({
        token: res.token,
        worker: res.worker || worker,
        emailConfirmed: true,
        lockReason: res.lockReason ?? (res.accountInactive ? 'account_inactive' : null),
        requiresReloginAfterUnlock: false,
        previewConfirmToken: undefined,
      });
      notifySuccess(res.message || 'Email confirmed.');
    } catch {
      // Global feedback listener displays the error notification bar
    } finally {
      setChecking(false);
    }
  };

  const handleUnlockRelogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      notifyError('Enter your password to unlock the dashboard.');
      return;
    }
    setUnlocking(true);
    try {
      const session = await api.login(worker.username, password);
      onSessionUpdated({
        token: session.token,
        worker: session.worker,
        emailConfirmed: session.emailConfirmed,
        lockReason: session.lockReason,
        requiresReloginAfterUnlock: Boolean(session.requiresReloginAfterUnlock),
      });
      setPassword('');
      if (session.lockReason === null && !session.requiresReloginAfterUnlock) {
        notifySuccess('Dashboard unlocked.');
      }
    } catch {
      // Global feedback listener displays the error notification bar
    } finally {
      setUnlocking(false);
    }
  };

  const isEmailLocked = lockReason === 'email_not_confirmed';
  const isInactiveLocked = lockReason === 'account_inactive';
  const isReadyToRelogin = lockReason === null && requiresReloginAfterUnlock;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Account locked"
      className="fixed inset-0 z-50 bg-slate-900/35 backdrop-blur-[3px] flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-[92vh] overflow-y-auto">
        {/* Top Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-start gap-3.5">
          {isEmailLocked ? (
            <div className="w-10 h-10 rounded-lg bg-[#EAF5F5] text-teal-700 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5" />
            </div>
          ) : isInactiveLocked ? (
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-lg bg-[#EAF5F5] text-teal-700 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
          )}

          <div className="min-w-0">
            <p className="text-[11px] font-mono text-slate-500">
              {isEmailLocked
                ? 'Account Locked · Email Verification Required'
                : isInactiveLocked
                  ? 'Account Locked · Activation Required'
                  : 'Verified & Active · Confirm Session'}
            </p>
            <h2 className="mt-0.5 font-display text-lg font-bold text-slate-900 leading-snug">
              {isEmailLocked
                ? 'Confirm your email to unlock the dashboard'
                : isInactiveLocked
                  ? 'Account activation required'
                  : 'Confirm password to unlock'}
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {isEmailLocked && (
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Your account is signed in in locked mode. Confirm{' '}
              <span className="font-medium text-slate-900 break-all">
                {worker.email || 'your registered email'}
              </span>{' '}
              using the verification link sent by Supabase Auth before accessing
              LIMBAHIN ERP records.
            </p>
          )}

          {isInactiveLocked && (
            <div className="space-y-3">
              <div className="px-3.5 py-2.5 rounded-lg bg-[#EFF8F8] border border-teal-200 text-xs text-teal-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
                <span>Your email address is verified.</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Dashboard access remains locked while your worker record is{' '}
                <span className="font-semibold text-red-700">inactive</span>.
                Change <span className="font-mono text-slate-800">status</span>{' '}
                to <span className="font-mono text-teal-800">active</span> in
                Supabase (<span className="font-mono">public.workers</span>),
                then refresh below.
              </p>
            </div>
          )}

          {isReadyToRelogin && (
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Your email is confirmed and your account status is{' '}
              <span className="font-semibold text-teal-700">active</span>. Enter
              your password once to establish a full verified session.
            </p>
          )}

          {/* Account Summary Ledger */}
          <dl className="divide-y divide-slate-100 border-y border-slate-200 text-xs">
            <div className="py-2 flex items-center justify-between gap-4">
              <dt className="text-slate-500">Worker ID</dt>
              <dd className="font-mono font-semibold text-slate-900">
                {worker.id}
              </dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-4">
              <dt className="text-slate-500">Account</dt>
              <dd className="text-slate-900 truncate">
                @{worker.username}{' '}
                <span className="text-slate-400 capitalize">({worker.role})</span>
              </dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="text-slate-500 shrink-0">Email</dt>
              <dd className="flex items-center gap-2 min-w-0 justify-end">
                <span className="text-slate-900 truncate">
                  {worker.email || 'Not set'}
                </span>
                {isEmailLocked && !editingEmail && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewEmail(worker.email || '');
                      setEditingEmail(true);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-900 hover:underline shrink-0"
                  >
                    <Edit3 className="w-3 h-3" />
                    Change
                  </button>
                )}
              </dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-4">
              <dt className="text-slate-500">Email Verification</dt>
              <dd
                className={
                  emailConfirmed
                    ? 'font-medium text-teal-700'
                    : 'font-medium text-amber-700'
                }
              >
                {emailConfirmed ? 'Confirmed' : 'Pending confirmation'}
              </dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-4">
              <dt className="text-slate-500">Worker Status</dt>
              <dd
                className={
                  worker.status === 'active'
                    ? 'font-medium text-teal-700'
                    : 'font-medium text-red-700'
                }
              >
                {worker.status === 'active' ? 'Active' : 'Inactive'}
              </dd>
            </div>
          </dl>

          {/* Inline Change Email Form (only while email_not_confirmed) */}
          {isEmailLocked && editingEmail && (
            <form
              onSubmit={handleChangeEmailSubmit}
              className="p-3.5 rounded-lg bg-[#F5F8F9] border border-slate-200 space-y-3"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  New Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                    autoFocus
                    placeholder="name@mediacahayacerah.com"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-700"
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Updates your account email and sends a fresh confirmation link.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingEmail(false)}
                  disabled={savingEmail}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEmail}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap"
                >
                  {savingEmail ? 'Updating...' : 'Update & Send Link'}
                </button>
              </div>
            </form>
          )}

          {/* Actions */}
          {isReadyToRelogin ? (
            <form onSubmit={handleUnlockRelogin} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Password for @{worker.username}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
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
              <button
                type="submit"
                disabled={unlocking}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors"
              >
                <ShieldCheck className="w-4 h-4" />
                {unlocking ? 'Unlocking Dashboard...' : 'Unlock Dashboard'}
              </button>
            </form>
          ) : (
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => handleCheckStatus(false)}
                disabled={checking}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-60 rounded-lg transition-colors"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`}
                />
                {isEmailLocked
                  ? 'I Have Confirmed My Email — Check Status'
                  : 'Check Activation Status'}
              </button>

              {isEmailLocked && worker.email && (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending || cooldownSeconds > 0}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  <Mail className="w-3.5 h-3.5 text-teal-700" />
                  {resending ? (
                    <span>Sending Confirmation Email...</span>
                  ) : cooldownSeconds > 0 ? (
                    <span className="tabular-nums">
                      Resend Confirmation Email ({formatTimer(cooldownSeconds)})
                    </span>
                  ) : (
                    <span>Resend Confirmation Email</span>
                  )}
                </button>
              )}

              {isEmailLocked && previewConfirmToken && (
                <button
                  type="button"
                  onClick={handlePreviewConfirm}
                  disabled={checking}
                  className="w-full px-4 py-2 text-xs font-medium text-teal-800 bg-[#EFF8F8] border border-teal-200 hover:bg-teal-50 rounded-lg transition-colors"
                >
                  Confirm Email (Local Preview)
                </button>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 flex justify-center">
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-700 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
