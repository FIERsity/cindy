/**
 * 组织插件被服务端清理后的一次性汇总提示。
 *
 * 清理可能发生在主界面挂载前（冷启动对账），所以不能只依赖 push：Main 保留
 * owner 隔离的 pending 汇总，Renderer 先订阅再主动 consume；后续 push 也走同一
 * consume 入口。并发信号由 drain 串行吸收，避免重复弹窗或把后到的汇总留到下次。
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { createLogger } from '@/lib/logger';
import { isSecondaryWindow } from '@/lib/secondaryWindow';
import { toast } from '@/lib/toast';

const log = createLogger('usePluginRemovalNoticeToast');

export function usePluginRemovalNoticeToast(): void {
  const { t } = useTranslation();
  const translateRef = useRef(t);
  translateRef.current = t;

  useEffect(() => {
    // 副窗口不消费全局一次性通知，避免抢在主窗口前取走。
    if (isSecondaryWindow()) return undefined;

    let disposed = false;
    let draining = false;
    let consumeRequested = false;

    const drain = async (): Promise<void> => {
      if (draining) return;
      draining = true;
      try {
        while (consumeRequested && !disposed) {
          consumeRequested = false;
          try {
            const notice = await window.electronAPI.pluginMarket.consumeRemovalNotice();
            if (disposed || !notice) continue;
            const message = notice.count === 1 && notice.name
              ? translateRef.current('settings.ghosts.market.removalNotice.single', {
                  name: notice.name,
                })
              : translateRef.current('settings.ghosts.market.removalNotice.multiple', {
                  count: notice.count,
                });
            toast.info(message, { duration: 8000 });
          } catch (error) {
            log.warn('failed to consume plugin removal notice:', error);
          }
        }
      } finally {
        draining = false;
      }
    };

    const requestConsume = (): void => {
      consumeRequested = true;
      void drain();
    };

    // 先订阅再主动取，封住「初次 consume 与 listener 建立之间」的新通知窗口。
    const unsubscribe = window.electronAPI.pluginMarket.onRemovalNoticeAvailable(requestConsume);
    requestConsume();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
}
