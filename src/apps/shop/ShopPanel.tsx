import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import type { ShopItem, ShopItemsResponse, SubscriptionPrices, SubscriptionBenefits } from "@/lib/api";
import { getShopItems, purchaseShopItem, createPayment, subscribeWithNb, toggleAutoRenew, ApiError } from "@/lib/api";

type Tab = "subs" | "items" | "crypto";

const TABS: { key: Tab; label: string }[] = [
  { key: "subs", label: "subscriptions" },
  { key: "items", label: "shop" },
  { key: "crypto", label: "buy NiggaBytes" },
];

export function ShopPanel({ user: _user }: WindowContentProps) {
  const [tab, setTab] = useState<Tab>("subs");
  const [shopData, setShopData] = useState<ShopItemsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; isError: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const [activation, setActivation] = useState<{ tier: string; phase: 'processing' | 'success' | 'fading' } | null>(null);
  const activationTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      activationTimers.current.forEach(clearTimeout);
    };
  }, []);

  const showToast = useCallback((text: string, isError = false) => {
    setToast({ text, isError });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const data = await getShopItems();
      setShopData(data);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "couldn't load shop", true);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleBuy = useCallback(async (itemId: string) => {
    setBuying(itemId);
    try {
      const result = await purchaseShopItem(itemId);
      showToast(result.message);
      const data = await getShopItems();
      setShopData(data);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "purchase failed", true);
    } finally {
      setBuying(null);
    }
  }, [showToast]);

  const handleCryptoPayment = useCallback(async (type: string, nbAmount?: number) => {
    const key = `${type}-${nbAmount ?? ""}`;
    setBuying(key);
    try {
      const result = await createPayment(type, nbAmount);
      window.open(result.invoice_url, "_blank");
      showToast("payment page opened in new tab. pay up and come back.");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "payment failed", true);
    } finally {
      setBuying(null);
    }
  }, [showToast]);

  const handleNbSubscribe = useCallback(async (type: string) => {
    setBuying(`nb-${type}`);
    const tier = type.includes('premium') ? 'Premium' : 'Basic';
    setActivation({ tier, phase: 'processing' });
    try {
      await subscribeWithNb(type);
      setActivation({ tier, phase: 'success' });
      const data = await getShopItems();
      setShopData(data);
      activationTimers.current.forEach(clearTimeout);
      activationTimers.current = [
        setTimeout(() => setActivation({ tier, phase: 'fading' }), 4500),
        setTimeout(() => setActivation(null), 5500),
      ];
    } catch (err) {
      setActivation(null);
      showToast(err instanceof ApiError ? err.message : "purchase failed", true);
    } finally {
      setBuying(null);
    }
  }, [showToast]);

  const handleToggleAutoRenew = useCallback(async (enabled: boolean) => {
    try {
      const result = await toggleAutoRenew(enabled);
      showToast(result.message);
      const data = await getShopItems();
      setShopData(data);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "failed to toggle auto-renew", true);
    }
  }, [showToast]);

  if (loading || !shopData) {
    return (
      <div className="panel-view">
        <div className="admin-loading">
          <span className="spinner" />
          loading...
        </div>
      </div>
    );
  }

  const nbBalance = shopData.nb_balance;
  const niceEgg = nbBalance === 69;

  return (
    <div className="panel-view shop-panel">
      <div className="panel-view-header">
        <h2>shop</h2>
        <span className="shop-balance">
          {niceEgg ? "nice." : nbBalance}
          <span className="shop-balance-label"> NiggaBytes</span>
        </span>
      </div>

      <div className="shop-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`shop-tab${tab === t.key ? " shop-tab--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="shop-content">
        {activation ? (
          <SubActivation tier={activation.tier} phase={activation.phase} />
        ) : (
          <>
            {tab === "subs" && (
              <SubscriptionTab
                prices={shopData.subscription_prices}
                benefits={shopData.subscription_benefits}
                activeSub={shopData.active_subscription}
                nbBalance={nbBalance}
                buying={buying}
                onBuyEur={handleCryptoPayment}
                onBuyNb={handleNbSubscribe}
                onToggleAutoRenew={handleToggleAutoRenew}
              />
            )}
            {tab === "items" && (
              <NbShopTab
                items={shopData.items}
                nbBalance={nbBalance}
                buying={buying}
                onBuy={handleBuy}
              />
            )}
            {tab === "crypto" && (
              <CryptoBuyTab
                packs={shopData.nb_packs}
                buying={buying}
                onBuy={handleCryptoPayment}
              />
            )}
          </>
        )}
      </div>

      {toast && (
        <div className={`shop-toast${toast.isError ? " shop-toast-error" : ""}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ── Subscription Activation Animation ── */

const SCRAMBLE_CHARS = "!@#$%^&*01ABCDEF";
function useScrambleText(target: string, active: boolean, speed = 40): string {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!active) { setText(""); return; }
    let idx = 0;
    const iv = setInterval(() => {
      idx++;
      const resolved = Math.min(idx, target.length);
      let out = target.slice(0, resolved);
      for (let i = resolved; i < target.length; i++) {
        out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]!;
      }
      setText(out);
      if (resolved >= target.length) clearInterval(iv);
    }, speed);
    return () => clearInterval(iv);
  }, [target, active, speed]);
  return text;
}

function SubActivation({ tier, phase }: { tier: string; phase: 'processing' | 'success' | 'fading' }) {
  const isSuccess = phase === 'success' || phase === 'fading';
  const title = useScrambleText(`${tier.toUpperCase()} ACTIVATED`, isSuccess, 50);
  const [lines, setLines] = useState<string[]>([]);
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; angle: number; speed: number; size: number }[]>([]);

  // Terminal-style lines appearing
  useEffect(() => {
    if (phase !== 'processing') return;
    const msgs = ["> verifying balance...", "> processing payment...", "> upgrading account..."];
    const timers: ReturnType<typeof setTimeout>[] = [];
    msgs.forEach((msg, i) => {
      timers.push(setTimeout(() => setLines(prev => [...prev, msg]), i * 400));
    });
    return () => { timers.forEach(clearTimeout); setLines([]); };
  }, [phase]);

  // Success lines
  useEffect(() => {
    if (phase !== 'success') return;
    setLines(["> verifying balance...", "> processing payment...", "> upgrading account...", `> SUBSCRIPTION ACTIVATED`]);
  }, [phase]);

  // Spawn particles on success
  useEffect(() => {
    if (!isSuccess) return;
    const pts = Array.from({ length: 24 }, (_, i) => ({
      id: i,
      x: 50 + (Math.random() - 0.5) * 20,
      y: 50 + (Math.random() - 0.5) * 20,
      angle: (i / 24) * 360 + Math.random() * 15,
      speed: 60 + Math.random() * 80,
      size: 2 + Math.random() * 3,
    }));
    setParticles(pts);
  }, [isSuccess]);

  return (
    <div className={`sub-activation${isSuccess ? " sub-activation--success" : ""}${phase === "fading" ? " sub-activation--fading" : ""}`}>
      <div className="sub-activation-inner">
        {/* Radiating rings */}
        {isSuccess && (
          <>
            <div className="sub-act-ring sub-act-ring--1" />
            <div className="sub-act-ring sub-act-ring--2" />
            <div className="sub-act-ring sub-act-ring--3" />
          </>
        )}

        {/* Particles */}
        {particles.map(p => {
          const rad = (p.angle * Math.PI) / 180;
          return (
            <div
              key={p.id}
              className="sub-act-particle"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: p.size,
                height: p.size,
                '--dx': `${Math.cos(rad) * p.speed}px`,
                '--dy': `${Math.sin(rad) * p.speed}px`,
              } as React.CSSProperties}
            />
          );
        })}

        {/* Content */}
        <div className="sub-act-content">
          {!isSuccess ? (
            <>
              <div className="sub-act-spinner" />
              <div className="sub-act-lines">
                {lines.map((l, i) => (
                  <div key={i} className="sub-act-line">{l}</div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="sub-act-title">{title}</div>
              <div className="sub-act-lines sub-act-lines--done">
                {lines.map((l, i) => (
                  <div key={i} className={`sub-act-line${l.includes("ACTIVATED") ? " sub-act-line--ok" : ""}`}>{l}</div>
                ))}
              </div>
              <div className="sub-act-welcome">{tier.includes('Premium') ? "welcome to the club." : "welcome aboard."}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── NB Shop (items) ── */

function NbShopTab({ items, nbBalance, buying, onBuy }: {
  items: ShopItem[];
  nbBalance: number;
  buying: string | null;
  onBuy: (id: string) => void;
}) {
  return (
    <table className="shop-table">
      <thead>
        <tr>
          <th>item</th>
          <th>owned</th>
          <th>price</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => {
          const canAfford = item.price !== null && nbBalance >= item.price;
          const isBuying = buying === item.id;
          return (
            <tr key={item.id} className={item.sold_out ? "shop-row-sold-out" : ""}>
              <td>
                <span className="shop-cell-name">{item.name}</span>
                <span className="shop-cell-desc">{item.description}</span>
              </td>
              <td className="shop-cell-owned">
                {item.total_slots}/{item.max_slots}
              </td>
              <td className="shop-cell-price">
                {item.sold_out ? (
                  <span className="shop-maxed">maxed</span>
                ) : (
                  <span className={canAfford ? "shop-affordable" : "shop-broke"}>
                    {item.price} NiggaBytes
                  </span>
                )}
              </td>
              <td className="shop-cell-action">
                {!item.sold_out && (
                  <button
                    className={`btn btn-sm${canAfford ? " btn-primary" : ""}`}
                    disabled={isBuying || !canAfford}
                    onClick={() => void onBuy(item.id)}
                  >
                    {isBuying ? "..." : "buy"}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── Buy NiggaBytes (crypto) ── */

function CryptoBuyTab({ packs, buying, onBuy }: {
  packs: number[];
  buying: string | null;
  onBuy: (type: string, nbAmount: number) => void;
}) {
  return (
    <div>
      <div className="shop-hint">
        buy NiggaBytes with crypto. 1 NiggaByte = 1 EUR. BTC, ETH, or 100+ other coins.
      </div>
      <div className="crypto-grid">
        {packs.map(amount => {
          const key = `nb-${amount}`;
          const isBuying = buying === key;
          return (
            <button
              key={amount}
              className={`crypto-pack${isBuying ? " crypto-pack--busy" : ""}`}
              disabled={isBuying}
              onClick={() => void onBuy("nb", amount)}
            >
              <span className="crypto-pack-amount">{amount}</span>
              <span className="crypto-pack-label">NiggaBytes</span>
              <span className="crypto-pack-price">
                {isBuying ? "..." : `${amount} EUR`}
              </span>
            </button>
          );
        })}
      </div>
      <div className="shop-hint" style={{ marginTop: 16, marginBottom: 0 }}>
        you'll be redirected to a payment page. NiggaBytes get credited after confirmation.
        {packs.some(p => p === 69) ? " nice." : ""}
      </div>
    </div>
  );
}

/* ── Subscriptions ── */

type Duration = '1m' | '3m' | '12m';
type PayCurrency = 'eur' | 'nb';

const DURATIONS: { key: Duration; label: string; months: number }[] = [
  { key: '1m', label: '1 month', months: 1 },
  { key: '3m', label: '3 months', months: 3 },
  { key: '12m', label: '12 months', months: 12 },
];

function SubscriptionTab({ prices, benefits, activeSub, nbBalance, buying, onBuyEur, onBuyNb, onToggleAutoRenew }: {
  prices: SubscriptionPrices;
  benefits: SubscriptionBenefits;
  activeSub: { type: string; expires_at: string | null; is_active: number; auto_renew: number } | null;
  nbBalance: number;
  buying: string | null;
  onBuyEur: (type: string) => void;
  onBuyNb: (type: string) => void;
  onToggleAutoRenew: (enabled: boolean) => void;
}) {
  const [duration, setDuration] = useState<Duration>('12m');
  const [currency, setCurrency] = useState<PayCurrency>('eur');

  const formatExpiry = (expiresAt: string | null) => {
    if (!expiresAt) return "forever";
    const d = new Date(expiresAt + "Z");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const subLabel = (type: string) => {
    if (type.includes('premium')) return 'Premium';
    if (type.includes('basic')) return 'Basic';
    return type;
  };

  const savePct = (tier: 'basic' | 'premium', dur: Duration): number => {
    if (dur === '1m') return 0;
    const base = prices[tier]['1m'];
    const discounted = prices[tier][dur];
    return Math.round((1 - discounted / base) * 100);
  };

  const selectedDur = DURATIONS.find(d => d.key === duration)!;
  const renderPrice = (tier: 'basic' | 'premium') => {
    const perMonth = prices[tier][duration];
    const totalEur = Math.round(perMonth * selectedDur.months * 100) / 100;
    const totalNb = Math.ceil(perMonth * selectedDur.months);
    if (currency === 'eur') {
      return (
        <>
          <div className="sub-card-price">
            <span className="sub-card-price-amount">{"\u20AC"}{perMonth.toFixed(2)}</span>
            <span className="sub-card-price-period">/mo</span>
          </div>
          <div className="sub-card-price-sub">
            {selectedDur.months > 1 ? `${"\u20AC"}${totalEur.toFixed(2)} total` : "\u00A0"}
          </div>
        </>
      );
    }
    const broke = nbBalance < totalNb;
    const nbPerMonth = Math.ceil(totalNb / selectedDur.months);
    return (
      <>
        <div className="sub-card-price">
          <span className="sub-card-price-amount">{nbPerMonth}</span>
          <span className="sub-card-price-period"> NB/mo</span>
        </div>
        <div className="sub-card-price-sub">
          {selectedDur.months > 1
            ? <>{totalNb} NB total{broke ? <span className="sub-card-broke"> &mdash; insufficient</span> : ""}</>
            : broke ? <span className="sub-card-broke">insufficient balance</span> : "\u00A0"
          }
        </div>
      </>
    );
  };

  // Tier level for downgrade prevention
  const TIER_LEVEL: Record<string, number> = { basic: 2, premium: 3 };
  const activeLevel = activeSub?.is_active === 1
    ? (activeSub.type.includes('premium') ? 3 : activeSub.type.includes('basic') ? 2 : 0)
    : 0;

  const isDowngrade = (tier: 'basic' | 'premium') => TIER_LEVEL[tier]! < activeLevel;
  const isSameTier = (tier: 'basic' | 'premium') => {
    if (!activeSub || activeSub.is_active !== 1) return false;
    return activeSub.type.includes(tier);
  };

  // NB confirmation popup state
  const [confirmPurchase, setConfirmPurchase] = useState<{ tier: 'basic' | 'premium'; paymentType: string; nbCost: number } | null>(null);

  const handleSubscribe = (tier: 'basic' | 'premium') => {
    const paymentType = `sub_${tier}_${duration}`;
    if (currency === 'nb') {
      const perMonth = prices[tier][duration];
      const nbCost = Math.ceil(perMonth * selectedDur.months);
      setConfirmPurchase({ tier, paymentType, nbCost });
    } else {
      void onBuyEur(paymentType);
    }
  };

  const confirmNbPurchase = () => {
    if (!confirmPurchase) return;
    setConfirmPurchase(null);
    void onBuyNb(confirmPurchase.paymentType);
  };

  const isTierBuying = (tier: 'basic' | 'premium') => {
    const paymentType = `sub_${tier}_${duration}`;
    return buying === `${paymentType}-` || buying === `nb-${paymentType}`;
  };

  const cantAfford = (tier: 'basic' | 'premium') => {
    if (currency !== 'nb') return false;
    const perMonth = prices[tier][duration];
    return nbBalance < Math.ceil(perMonth * selectedDur.months);
  };

  return (
    <div>
      {activeSub && activeSub.is_active === 1 && (
        <div className="sub-active-banner">
          <div className="sub-active-banner-row">
            <span className="sub-active-banner-title">
              active: {subLabel(activeSub.type)}
            </span>
            <span className="sub-active-banner-sep">&mdash;</span>
            <span className="sub-active-banner-detail">
              {activeSub.expires_at ? `expires ${formatExpiry(activeSub.expires_at)}` : "never expires"}
            </span>
          </div>
          <button
            className={`sub-autorenew${activeSub.auto_renew ? " sub-autorenew--on" : ""}`}
            onClick={() => void onToggleAutoRenew(!activeSub.auto_renew)}
          >
            <span className="sub-autorenew-dot" />
            auto-renew {activeSub.auto_renew ? "on" : "off"}
          </button>
        </div>
      )}

      {/* Controls row: duration + currency */}
      <div className="sub-controls">
        <div className="sub-toggle">
          {DURATIONS.map(d => {
            const isActive = duration === d.key;
            const maxSave = Math.max(savePct('basic', d.key), savePct('premium', d.key));
            return (
              <button
                key={d.key}
                className={`sub-toggle-btn${isActive ? " sub-toggle-btn--active" : ""}`}
                onClick={() => setDuration(d.key)}
              >
                {d.label}
                {maxSave > 0 && (
                  <span className="sub-toggle-save">-{maxSave}%</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="sub-toggle sub-toggle--pay">
          <button
            className={`sub-toggle-btn${currency === 'eur' ? ' sub-toggle-btn--active' : ''}`}
            onClick={() => setCurrency('eur')}
          >
            crypto
          </button>
          <button
            className={`sub-toggle-btn${currency === 'nb' ? ' sub-toggle-btn--active' : ''}`}
            onClick={() => setCurrency('nb')}
          >
            NiggaBytes
          </button>
        </div>
      </div>

      {/* Tier cards */}
      <div className="sub-grid">
        {/* Basic */}
        <div className="sub-card">
          <div className="sub-card-head">
            <div className="sub-card-tier sub-card-tier--basic">basic</div>
            {renderPrice('basic')}
          </div>
          <div className="sub-card-benefits">
            {benefits.basic.map((b, i) => (
              <div key={i} className="sub-card-benefit">
                <span className="sub-card-check sub-card-check--basic">&bull;</span>
                {b}
              </div>
            ))}
          </div>
          <div className="sub-card-foot">
            {isSameTier('basic') ? (
              <div className="sub-btn sub-btn--current">current plan</div>
            ) : isDowngrade('basic') ? (
              <div className="sub-btn sub-btn--downgrade">you have better lmao</div>
            ) : (
              <button
                className="sub-btn sub-btn--basic"
                disabled={isTierBuying('basic') || cantAfford('basic')}
                onClick={() => handleSubscribe('basic')}
              >
                {isTierBuying('basic') ? "..." : "subscribe"}
              </button>
            )}
          </div>
        </div>

        {/* Premium */}
        <div className="sub-card sub-card--premium">
          <div className="sub-card-label">recommended</div>
          <div className="sub-card-head">
            <div className="sub-card-tier sub-card-tier--premium">premium</div>
            {renderPrice('premium')}
          </div>
          <div className="sub-card-benefits">
            {benefits.premium.map((b, i) => (
              <div key={i} className="sub-card-benefit">
                <span className="sub-card-check sub-card-check--premium">&bull;</span>
                {b}
              </div>
            ))}
          </div>
          <div className="sub-card-foot">
            {isSameTier('premium') ? (
              <div className="sub-btn sub-btn--current">current plan</div>
            ) : (
              <button
                className="sub-btn sub-btn--premium"
                disabled={isTierBuying('premium') || cantAfford('premium')}
                onClick={() => handleSubscribe('premium')}
              >
                {isTierBuying('premium') ? "..." : activeLevel >= 2 ? "upgrade" : "subscribe"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="sub-footer">
        {currency === 'eur'
          ? "pay with crypto — BTC, ETH, and 100+ coins accepted."
          : `pay with your NiggaBytes balance (${nbBalance} available).`
        } NiggaBytes subs can auto-renew. upgrading replaces your current plan.
      </div>

      {/* NB Purchase Confirmation Popup */}
      {confirmPurchase && (
        <div className="sub-confirm-overlay" onClick={() => setConfirmPurchase(null)}>
          <div className="sub-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="sub-confirm-header">
              <span className="sub-confirm-title">confirm purchase</span>
              <button className="sub-confirm-close" onClick={() => setConfirmPurchase(null)}>&times;</button>
            </div>
            <div className="sub-confirm-body">
              <span className="sub-confirm-nb">{confirmPurchase.nbCost} NB</span> for{" "}
              <span className="sub-confirm-tier">{confirmPurchase.tier === 'premium' ? 'premium' : 'member'}</span> subscription.
              <br />
              {confirmPurchase.nbCost > nbBalance * 0.5
                ? "that's more than half your stash. you sure about this?"
                : "no refunds once purchased."
              }
            </div>
            <div className="sub-confirm-balance">
              balance after: <span style={{ color: (nbBalance - confirmPurchase.nbCost) < 10 ? "var(--error)" : "#fbbf24" }}>
                {nbBalance - confirmPurchase.nbCost} NB
              </span>
            </div>
            <div className="sub-confirm-actions">
              <button
                className="sub-confirm-btn sub-confirm-btn--cancel"
                onClick={() => setConfirmPurchase(null)}
              >
                cancel
              </button>
              <button
                className="sub-confirm-btn sub-confirm-btn--confirm"
                onClick={confirmNbPurchase}
              >
                confirm purchase
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
