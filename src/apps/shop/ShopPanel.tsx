import { useState, useEffect, useCallback, useRef } from "react";
import type { WindowContentProps } from "@/types/terminal";
import type { ShopItem } from "@/lib/api";
import { getShopItems, purchaseShopItem, ApiError } from "@/lib/api";

export function ShopPanel({ user: _user }: WindowContentProps) {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [nbBalance, setNbBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; isError: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  const showToast = useCallback((text: string, isError = false) => {
    setToast({ text, isError });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const data = await getShopItems();
      setItems(data.items);
      setNbBalance(data.nb_balance);
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
      setNbBalance(result.nb_balance);
      showToast(result.message);
      const data = await getShopItems();
      setItems(data.items);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "purchase failed", true);
    } finally {
      setBuying(null);
    }
  }, [showToast]);

  if (loading) {
    return (
      <div className="panel-view">
        <div className="admin-loading">
          <span className="spinner" />
          loading...
        </div>
      </div>
    );
  }

  const niceEgg = nbBalance === 69;

  return (
    <div className="panel-view" style={{ position: "relative" }}>
      <div className="panel-view-header">
        <h2>shop</h2>
        <span className="shop-nb-badge">
          {niceEgg ? "nice." : nbBalance}
          <span className="shop-nb-unit"> NB</span>
        </span>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
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
                      <span className={canAfford ? "shop-price-ok" : "shop-price-broke"}>
                        {item.price} NB
                      </span>
                    )}
                  </td>
                  <td className="shop-cell-action">
                    {!item.sold_out && (
                      <button
                        className={`btn btn-sm${canAfford ? " btn-primary" : ""}`}
                        disabled={isBuying || !canAfford}
                        onClick={() => void handleBuy(item.id)}
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
      </div>

      {/* Toast — absolute positioned, doesn't affect layout */}
      {toast && (
        <div className={`shop-toast${toast.isError ? " shop-toast-error" : ""}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
