import { useState, useEffect, useCallback, useRef } from "react";
import { createPayment, getActiveSubscription, subscribeWithNb, getNbBalance, validatePromo, redeemPromo, getShopItems } from "@/lib/api";
import type { PromoValidation, SubscriptionPrices, SubscriptionBenefits } from "@/lib/api";
import { AuthLogo } from "./AuthLogo";
import { ScrambleText } from "./ScrambleText";

interface Props {
  onSubscribed: () => void;
  onLogout: () => void;
}

type Duration = "1m" | "3m" | "12m";


const DURATION_MONTHS: Record<Duration, number> = {
  "1m": 1,
  "3m": 3,
  "12m": 12,
};

function fmtNB(n: number) {
  return n.toLocaleString("en-US");
}

const PARTICLE_COUNT = 24;
const PARTICLE_ANGLES = Array.from({ length: PARTICLE_COUNT }, (_, i) => (360 / PARTICLE_COUNT) * i);

function CelebrationOverlay({ tier, days, onDone }: { tier: string; days: number; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="promo-celebrate" onClick={onDone}>
      {PARTICLE_ANGLES.map((angle, i) => (
        <span
          key={i}
          className="promo-celebrate-particle"
          style={{
            "--angle": `${angle}deg`,
            "--delay": `${Math.random() * 0.3}s`,
            "--distance": `${120 + Math.random() * 80}px`,
            "--size": `${3 + Math.random() * 4}px`,
          } as React.CSSProperties}
        />
      ))}
      <div className="promo-celebrate-content">
        <div className="promo-celebrate-title">ACTIVATED</div>
        <div className="promo-celebrate-sub">{tier} &middot; {days} days</div>
      </div>
    </div>
  );
}

export function SubscribePage({ onSubscribed, onLogout }: Props) {
  const [duration, setDuration] = useState<Duration>("12m");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nbBalance, setNbBalance] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Dynamic prices/benefits from backend
  const [prices, setPrices] = useState<SubscriptionPrices | null>(null);
  const [benefits, setBenefits] = useState<SubscriptionBenefits | null>(null);

  // Promo state
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoValidating, setPromoValidating] = useState(false);
  const [promoResult, setPromoResult] = useState<PromoValidation | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<{ tier: string; days: number } | null>(null);

  // Auto-dismiss error after 4s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  // Fetch prices, benefits, and NB balance from backend
  useEffect(() => {
    getNbBalance()
      .then(r => setNbBalance(r.nb_balance))
      .catch(() => setNbBalance(0));
    getShopItems()
      .then(data => {
        setPrices(data.subscription_prices);
        setBenefits(data.subscription_benefits);
      })
      .catch(() => { /* keep fallbacks */ });
  }, []);

  // Poll for subscription activation (crypto)
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const sub = await getActiveSubscription();
        if (sub) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          onSubscribed();
        }
      } catch { /* ignore */ }
    }, 5000);
  }, [onSubscribed]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Derived discount info
  const discountPct = promoResult?.valid && promoResult.type === "discount_pct" ? promoResult.value ?? 0 : 0;
  const isFreeSub = promoResult?.valid && promoResult.type === "free_sub";
  const activePromoCode = promoResult?.valid ? promoCode.toUpperCase().trim() : undefined;

  const getTotalPrice = (planKey: "basic" | "premium") => {
    if (!prices) return 0;
    const price = prices[planKey][duration];
    return +(price * DURATION_MONTHS[duration]).toFixed(2);
  };

  const getDiscountedTotal = (planKey: "basic" | "premium") => {
    const total = getTotalPrice(planKey);
    if (!discountPct) return total;
    // Check tier compatibility
    if (promoResult?.sub_tier && promoResult.sub_tier !== planKey) return total;
    const discounted = Math.round(total * (1 - discountPct / 100) * 100) / 100;
    return Math.max(0.50, discounted);
  };

  const isDiscountApplicable = (planKey: "basic" | "premium") => {
    if (!discountPct) return false;
    if (promoResult?.sub_tier && promoResult.sub_tier !== planKey) return false;
    return true;
  };

  // 1 NB = 1 EUR
  const getNbCost = (planKey: "basic" | "premium") => {
    const total = getDiscountedTotal(planKey);
    return Math.max(1, Math.ceil(total));
  };

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoValidating(true);
    setPromoResult(null);
    try {
      const result = await validatePromo(promoCode.trim());
      setPromoResult(result);
      if (!result.valid) {
        setError(result.error ?? "invalid code");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "validation failed");
    } finally {
      setPromoValidating(false);
    }
  };

  const handleClearPromo = () => {
    setPromoCode("");
    setPromoResult(null);
  };

  const handleRedeem = async () => {
    setError(null);
    setLoading("redeem");
    try {
      const [result] = await Promise.all([
        redeemPromo(promoCode.trim()),
        new Promise<void>(r => setTimeout(r, 1500)),
      ]);
      setLoading(null);
      if (result.ok) {
        setRedeemSuccess({ tier: result.sub_tier, days: result.days });
      }
    } catch (err) {
      setLoading(null);
      setError(err instanceof Error ? err.message : "redeem failed.");
    }
  };

  const handleCrypto = async (plan: "basic" | "premium") => {
    setError(null);
    setLoading(`${plan}-crypto`);
    try {
      const type = `sub_${plan}_${duration}`;
      const [result] = await Promise.all([
        createPayment(type, undefined, isDiscountApplicable(plan) ? activePromoCode : undefined),
        new Promise<void>(r => setTimeout(r, 2000)),
      ]);
      setLoading(null);
      window.open(result.invoice_url, "_blank");
      startPolling();
    } catch (err) {
      setLoading(null);
      setError(err instanceof Error ? err.message : "payment failed.");
    }
  };

  const handleNb = async (plan: "basic" | "premium") => {
    setError(null);
    setLoading(`${plan}-nb`);
    try {
      const type = `sub_${plan}_${duration}`;
      const [result] = await Promise.all([
        subscribeWithNb(type, isDiscountApplicable(plan) ? activePromoCode : undefined),
        new Promise<void>(r => setTimeout(r, 2000)),
      ]);
      setLoading(null);
      if (result.ok) {
        setNbBalance(result.nb_balance);
        onSubscribed();
      }
    } catch (err) {
      setLoading(null);
      setError(err instanceof Error ? err.message : "payment failed.");
    }
  };

  return (
    <div className="auth-page">
      {redeemSuccess && (
        <CelebrationOverlay
          tier={redeemSuccess.tier}
          days={redeemSuccess.days}
          onDone={onSubscribed}
        />
      )}
      <div className="subscribe-container">
        <AuthLogo />
        <p className="auth-hint" style={{ marginTop: -16, marginBottom: 24 }}>choose your plan to continue</p>

        {!prices || !benefits ? (
          <div className="auth-hint" style={{ opacity: 0.5, padding: "40px 0" }}>loading plans...</div>
        ) : <>
        <div className="duration-toggle">
          {(["1m", "3m", "12m"] as Duration[]).map(d => (
            <button
              key={d}
              type="button"
              className={`duration-btn ${duration === d ? "active" : ""}`}
              onClick={() => setDuration(d)}
            >
              {d === "1m" ? "Monthly" : d === "3m" ? "Quarterly" : "Yearly"}
              {d !== "1m" && prices.premium["1m"] > 0 && (() => {
                const pct = Math.round((1 - prices.premium[d] / prices.premium["1m"]) * 100);
                return pct > 0 ? <span className="duration-save">save ~{pct}%</span> : null;
              })()}
            </button>
          ))}
        </div>

        <div className="plan-cards">
          {(["basic", "premium"] as const).map(planKey => {
            const planName = planKey === "premium" ? "Premium" : "Basic";
            const price = prices[planKey][duration];
            const planBenefits = benefits[planKey];
            const total = getTotalPrice(planKey);
            const discounted = getDiscountedTotal(planKey);
            const hasDiscount = isDiscountApplicable(planKey);
            const nbCost = getNbCost(planKey);
            const canAffordNb = nbBalance !== null && nbBalance >= nbCost;

            // For free_sub: check if this plan matches the tier
            const freeSubMatch = isFreeSub && (!promoResult?.sub_tier || promoResult.sub_tier === planKey);

            return (
              <div key={planKey} className={`plan-card ${planKey === "premium" ? "plan-card-featured" : ""}`}>
                {planKey === "premium" && (
                  <div className="plan-badge">BEST VALUE</div>
                )}
                {hasDiscount && (
                  <div className="plan-discount-badge">{discountPct}% OFF</div>
                )}
                <h2 className="plan-name">{planName}</h2>
                <div className="plan-price">
                  {hasDiscount ? (
                    <>
                      <span className="plan-price-amount plan-price-struck">{price.toFixed(2)}</span>
                      <span className="plan-price-amount plan-price-discounted">
                        {(price * (1 - discountPct / 100)).toFixed(2)}
                      </span>
                    </>
                  ) : (
                    <span className="plan-price-amount">{price.toFixed(2)}</span>
                  )}
                  <span className="plan-price-unit">/mo</span>
                </div>
                <div className="plan-total">
                  {duration !== "1m" ? (
                    hasDiscount ? (
                      <>
                        <span style={{ textDecoration: "line-through", opacity: 0.5, marginRight: 6 }}>
                          {total.toFixed(2)}
                        </span>
                        {discounted.toFixed(2)} total
                      </>
                    ) : (
                      <>{total.toFixed(2)} total</>
                    )
                  ) : (
                    /* keep consistent height even on monthly */
                    <span style={{ visibility: "hidden" }}>0</span>
                  )}
                </div>
                <ul className="plan-features">
                  {planBenefits.map(f => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <div className="plan-btns">
                  {freeSubMatch ? (
                    <button
                      type="button"
                      className={`plan-btn plan-btn-featured plan-btn-redeem${loading === "redeem" ? " plan-btn-busy" : ""}`}
                      onClick={() => void handleRedeem()}
                      disabled={loading !== null}
                    >
                      {loading === "redeem" ? (
                        <ScrambleText text="activating" />
                      ) : (
                        `redeem: ${promoResult?.value ?? 0} days free`
                      )}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`plan-btn ${planKey === "premium" ? "plan-btn-featured" : ""}${loading === `${planKey}-crypto` ? " plan-btn-busy" : ""}`}
                        onClick={() => void handleCrypto(planKey)}
                        disabled={loading !== null}
                      >
                        {loading === `${planKey}-crypto` ? (
                          <ScrambleText text="generating invoice" />
                        ) : (
                          `pay ${(hasDiscount ? discounted : total).toFixed(2)}€ crypto`
                        )}
                      </button>
                      <button
                        type="button"
                        className={`plan-btn plan-btn-nb${loading === `${planKey}-nb` ? " plan-btn-busy" : ""}`}
                        onClick={() => void handleNb(planKey)}
                        disabled={loading !== null || !canAffordNb}
                        title={!canAffordNb ? `need ${nbCost} NB, you have ${fmtNB(nbBalance ?? 0)}` : undefined}
                      >
                        {loading === `${planKey}-nb` ? (
                          <ScrambleText text="processing payment" />
                        ) : (
                          `pay ${fmtNB(nbCost)} NB`
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Promo code section */}
        <div className="promo-section">
          {!promoOpen ? (
            <button
              type="button"
              className="promo-toggle"
              onClick={() => setPromoOpen(true)}
            >
              have a promo code?
            </button>
          ) : (
            <div className="promo-input-row">
              <input
                className="auth-input promo-input"
                placeholder="ENTER CODE"
                value={promoCode}
                onChange={e => {
                  setPromoCode(e.target.value.toUpperCase());
                  if (promoResult) setPromoResult(null);
                }}
                onKeyDown={e => { if (e.key === "Enter") void handleApplyPromo(); }}
                disabled={promoValidating}
                style={{ textTransform: "uppercase" }}
              />
              {promoResult?.valid ? (
                <button
                  type="button"
                  className="promo-clear-btn"
                  onClick={handleClearPromo}
                >
                  clear
                </button>
              ) : (
                <button
                  type="button"
                  className="promo-apply-btn"
                  onClick={() => void handleApplyPromo()}
                  disabled={promoValidating || !promoCode.trim()}
                >
                  {promoValidating ? "..." : "apply"}
                </button>
              )}
            </div>
          )}
          {promoResult?.valid && (
            <div className="promo-active-badge">
              {promoResult.type === "discount_pct"
                ? `${promoResult.value}% discount applied`
                : `free ${promoResult.sub_tier ?? "basic"} — ${promoResult.value} days`
              }
            </div>
          )}
        </div>

        {nbBalance !== null && (
          <div className="sub-nb-balance">
            your balance: <span className="sub-nb-amount">{fmtNB(nbBalance)} NB</span>
          </div>
        )}
        </>}

        {error && <div className="auth-error">{error}</div>}

        {pollRef.current && (
          <div className="subscribe-polling">
            <span className="spinner" /> waiting for payment confirmation...
          </div>
        )}

        <div className="subscribe-footer">
          <button type="button" className="auth-switch-btn" onClick={onLogout}>
            sign out
          </button>
        </div>
      </div>
    </div>
  );
}
