/**
 * Authentication page.
 * Handles sign-in, sign-up verification, and password reset user flows.
 */

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '../utils/helpers'
import { isStrongPassword } from '../utils/authHelpers'
import type { Toast } from '../types/models'

interface Props {
  token:     string | null
  onLogin:   (token: string) => void
  pushToast: (kind: Toast['kind'], text: string) => void
}

export default function AuthPage({ token, onLogin, pushToast }: Props) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // Common fields
  const [email,           setEmail]           = useState('')
  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name,            setName]            = useState('')
  const [requestedRole,   setRequestedRole]   = useState<'Warehouse Staff' | 'Manager'>('Warehouse Staff')

  // Signup OTP
  const [signupStep,           setSignupStep]           = useState<'request' | 'verify'>('request')
  const [signupOtp,            setSignupOtp]            = useState('')
  const [signupOtpSentTo,      setSignupOtpSentTo]      = useState('')
  const [signupResendCooldown, setSignupResendCooldown] = useState(0)

  // Password reset
  const [showReset,            setShowReset]            = useState(false)
  const [resetStep,            setResetStep]            = useState<'request' | 'verify'>('request')
  const [resetBusy,            setResetBusy]            = useState(false)
  const [resetEmail,           setResetEmail]           = useState('')
  const [resetOtp,             setResetOtp]             = useState('')
  const [resetNewPassword,     setResetNewPassword]     = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')
  const [otpSentTo,            setOtpSentTo]            = useState('')
  const [resendCooldown,       setResendCooldown]       = useState(0)

  useEffect(() => { if (token) navigate('/dashboard', { replace: true }) }, [token, navigate])

  // Countdown timers
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setInterval(() => setResendCooldown((p) => Math.max(0, p - 1)), 1000)
    return () => clearInterval(t)
  }, [resendCooldown])

  useEffect(() => {
    if (signupResendCooldown <= 0) return
    const t = setInterval(() => setSignupResendCooldown((p) => Math.max(0, p - 1)), 1000)
    return () => clearInterval(t)
  }, [signupResendCooldown])

  // -- Password reset helpers --------------------------------------------------
  const requestResetOtp = async () => {
    if (!resetEmail.trim()) { pushToast('error', 'Email is required'); return }
    setResetBusy(true)
    try {
      await apiRequest<{ message?: string }>(
        '/auth/reset-password', 'POST', undefined, { email: resetEmail },
      )
      setResetStep('verify')
      setOtpSentTo(resetEmail.trim())
      setResendCooldown(30)
      pushToast('info', 'OTP sent to your email')
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setResetBusy(false)
    }
  }

  const submitPasswordReset = async () => {
    if (!resetEmail.trim())                   { pushToast('error', 'Email is required'); return }
    if (!resetOtp.trim())                     { pushToast('error', 'OTP is required'); return }
    if (!isStrongPassword(resetNewPassword))  { pushToast('error', 'Use a stronger password: at least 8 characters with letters and numbers'); return }
    if (resetNewPassword !== resetConfirmPassword) { pushToast('error', 'Passwords do not match'); return }

    setResetBusy(true)
    try {
      await apiRequest('/auth/reset-password', 'POST', undefined, {
        email: resetEmail, otp: resetOtp, newPassword: resetNewPassword,
      })
      pushToast('success', 'Password reset completed. Please sign in.')
      setShowReset(false)
      setResetStep('request')
      setResetOtp('')
      setResetNewPassword('')
      setResetConfirmPassword('')
      setOtpSentTo('')
      setResendCooldown(0)
      setMode('login')
    } catch (err) {
      pushToast('error', (err as Error).message)
    } finally {
      setResetBusy(false)
    }
  }

  // -- Main form submit --------------------------------------------------------
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim())                                 { pushToast('error', 'Email is required'); return }
    if (mode === 'login' && password.length < 6)       { pushToast('error', 'Password must be at least 6 characters'); return }
    if (mode === 'signup' && !name.trim())             { pushToast('error', 'Name is required'); return }
    if (mode === 'signup' && !isStrongPassword(password)) { pushToast('error', 'Use a stronger password: at least 8 characters with letters and numbers'); return }
    if (mode === 'signup' && password !== confirmPassword) { pushToast('error', 'Passwords do not match'); return }

    setBusy(true)
    try {
      if (mode === 'login') {
        const data = await apiRequest<{ token: string }>('/auth/login', 'POST', undefined, { email, password })
        onLogin(data.token)
        pushToast('success', 'Login successful')
        navigate('/dashboard', { replace: true })
      }

      if (mode === 'signup') {
        if (signupStep === 'request') {
          await apiRequest<{ message?: string }>(
            '/auth/register', 'POST', undefined, { name, email, password, role: requestedRole },
          )
          setSignupStep('verify')
          setSignupOtpSentTo(email.trim())
          setSignupResendCooldown(30)
          pushToast('info', 'OTP sent to your email')
        } else {
          if (!signupOtp.trim()) { pushToast('error', 'OTP is required'); return }
          await apiRequest('/auth/register', 'POST', undefined, { name, email, password, role: requestedRole, otp: signupOtp })
          pushToast('success', 'Account created. Sign in now - admin approval needed for your requested role.')
          setSignupStep('request')
          setSignupOtp('')
          setSignupOtpSentTo('')
          setSignupResendCooldown(0)
          setRequestedRole('Warehouse Staff')
          setConfirmPassword('')
          setMode('login')
        }
      }
    } catch (err) {
      const msg = (err as Error).message
      setAuthError(msg)
      pushToast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  const switchToSignup = () => {
    setMode('signup')
    setAuthError(null)
    setSignupStep('request')
    setSignupOtp('')
    setSignupOtpSentTo('')
    setSignupResendCooldown(0)
    setRequestedRole('Warehouse Staff')
    setConfirmPassword('')
  }

  return (
    <div className="auth-page">
      <div className="auth-layout">
        <aside className="auth-hero-panel">
          <div className="auth-logo">
            <img className="auth-logo-image" src="/odoo.png" alt="Core Inventory logo" />
            <div className="auth-logo-text">
              <h2>Core Inventory</h2>
              <p>Inventory Management System</p>
            </div>
          </div>
          <h3 className="auth-hero-title">Run warehouse operations without spreadsheet chaos.</h3>
          <p className="auth-hero-copy">
            Track stock, manage transfers, validate deliveries, and monitor inventory in one consistent workspace.
          </p>
          <div className="auth-hero-points">
            <span>Live stock visibility</span>
            <span>Operational traceability</span>
            <span>Centralized product control</span>
          </div>
        </aside>

        <div className="auth-card">
          <div className="auth-card-head">
            <h3>{mode === 'login' ? 'Welcome Back' : 'Create Your Account'}</h3>
            <p>
              {mode === 'login'
                ? 'Sign in to continue managing inventory operations.'
                : signupStep === 'request'
                  ? 'Request an OTP to verify your email and submit your role request.'
                  : 'Enter the OTP to verify your email and finish account setup.'}
            </p>
          </div>

          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab${mode === 'login' ? ' active' : ''}`}
              onClick={() => { setMode('login'); setAuthError(null) }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-tab${mode === 'signup' ? ' active' : ''}`}
              onClick={switchToSignup}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={submit}>
            {mode === 'signup' && (
              <div className="form-field">
                <label className="form-field-label">Full Name</label>
                <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" required />
              </div>
            )}
            {mode === 'signup' && (
              <div className="form-field">
                <label className="form-field-label">Requested Role</label>
                <select className="form-select" value={requestedRole} onChange={(e) => setRequestedRole(e.target.value as 'Warehouse Staff' | 'Manager')}>
                  <option value="Warehouse Staff">Warehouse Staff</option>
                  <option value="Manager">Manager</option>
                </select>
              </div>
            )}
            <div className="form-field">
              <label className="form-field-label">Email Address</label>
              <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
            </div>
            <div className="form-field">
              <label className="form-field-label">Password</label>
              <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={mode === 'signup' ? 8 : 6} />
            </div>

            {mode === 'signup' && (
              <div className="form-field">
                <label className="form-field-label">Confirm Password</label>
                <input className="form-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter password" required minLength={8} />
                {confirmPassword && (
                  <p className={password === confirmPassword ? 'password-match' : 'password-mismatch'}>
                    {password === confirmPassword ? '[OK] Passwords match' : '[X] Passwords do not match'}
                  </p>
                )}
                <p className="password-help">At least 8 characters with letters and numbers.</p>
              </div>
            )}

            {mode === 'signup' && signupStep === 'verify' && (
              <>
                {signupOtpSentTo && <p className="muted auth-reset-note">OTP sent to {signupOtpSentTo}</p>}
                <div className="form-field">
                  <label className="form-field-label">Verification OTP</label>
                  <input className="form-input" value={signupOtp} onChange={(e) => setSignupOtp(e.target.value)} placeholder="Enter 6-digit OTP" required />
                </div>
                <div className="auth-reset-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy || signupResendCooldown > 0}
                    onClick={async () => {
                      if (!name.trim() || !email.trim() || !isStrongPassword(password) || password !== confirmPassword) {
                        pushToast('error', 'Check your details and use a strong, matching password')
                        return
                      }
                      try {
                        await apiRequest<{ message?: string }>(
                          '/auth/register', 'POST', undefined, { name, email, password, role: requestedRole },
                        )
                        setSignupResendCooldown(30)
                        pushToast('info', 'OTP resent to your email')
                      } catch (err) {
                        pushToast('error', (err as Error).message)
                      }
                    }}
                  >
                    {signupResendCooldown > 0 ? `Resend in ${signupResendCooldown}s` : 'Resend OTP'}
                  </button>
                </div>
              </>
            )}

            <button type="submit" className="btn btn-primary auth-submit-btn" disabled={busy}>
              {busy
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign In'
                  : signupStep === 'request'
                    ? 'Send Verification OTP'
                    : 'Verify & Create Account'}
            </button>
            {authError && <div className="auth-error">{authError}</div>}

            {mode === 'login' && (
              <button
                type="button"
                className="link-btn auth-reset-toggle"
                onClick={() => {
                  setShowReset((p) => !p)
                  setResetStep('request')
                  setResetOtp('')
                  setResetNewPassword('')
                  setResetConfirmPassword('')
                  setResetEmail(email)
                  setOtpSentTo('')
                  setResendCooldown(0)
                }}
              >
                {showReset ? 'Cancel password reset' : 'Forgot password?'}
              </button>
            )}

            {mode === 'login' && showReset && (
              <div className="reset-box">
                <div className="form-field">
                  <label className="form-field-label">Email for reset</label>
                  <input className="form-input" type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} required />
                </div>
                {resetStep === 'verify' && otpSentTo && (
                  <p className="muted auth-reset-note">OTP sent to {otpSentTo}</p>
                )}
                {resetStep === 'verify' && (
                  <>
                    <div className="form-field">
                      <label className="form-field-label">OTP Code</label>
                      <input className="form-input" value={resetOtp} onChange={(e) => setResetOtp(e.target.value)} required />
                    </div>
                    <div className="form-field">
                      <label className="form-field-label">New Password</label>
                      <input className="form-input" type="password" value={resetNewPassword} onChange={(e) => setResetNewPassword(e.target.value)} minLength={8} required />
                      <p className="password-help">At least 8 characters with letters and numbers.</p>
                    </div>
                    <div className="form-field">
                      <label className="form-field-label">Confirm New Password</label>
                      <input className="form-input" type="password" value={resetConfirmPassword} onChange={(e) => setResetConfirmPassword(e.target.value)} minLength={8} required />
                      {resetConfirmPassword && (
                        <p className={resetNewPassword === resetConfirmPassword ? 'password-match' : 'password-mismatch'}>
                          {resetNewPassword === resetConfirmPassword ? '[OK] Passwords match' : '[X] Passwords do not match'}
                        </p>
                      )}
                    </div>
                  </>
                )}
                <div className="auth-reset-actions">
                  <button type="button" className="btn btn-secondary" onClick={requestResetOtp} disabled={resetBusy || resendCooldown > 0}>
                    {resetBusy ? 'Sending...' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : resetStep === 'request' ? 'Send OTP' : 'Resend OTP'}
                  </button>
                  {resetStep === 'verify' && (
                    <button type="button" className="btn btn-primary" onClick={submitPasswordReset} disabled={resetBusy}>
                      {resetBusy ? 'Resetting...' : 'Reset Password'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
