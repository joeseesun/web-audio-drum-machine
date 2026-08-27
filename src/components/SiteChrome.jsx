import React, { useCallback, useEffect, useRef, useState } from 'react';

/* Public links — single source so the modals and the structured data agree. */
export const LINKS = {
  reward: { title: '打赏支持' },
  follow: { title: '关注向阳乔木' },
  wechatAccount: '向阳乔木推荐看',
  github: 'https://github.com/joeseesun/',
  x: 'https://x.com/vista8',
  tuijian: 'https://tuijian.qiaomu.ai/',
  repo: 'https://github.com/joeseesun/web-audio-drum-machine',
};

function Icon({ name }) {
  const common = { width: 17, height: 17, viewBox: '0 0 24 24', 'aria-hidden': true };
  if (name === 'reward') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0 1 12 6.6 5.3 5.3 0 0 1 21.3 12c-1.8 4.3-9.3 9-9.3 9z" />
      </svg>
    );
  }
  if (name === 'follow') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6M22 11h-6" />
      </svg>
    );
  }
  if (name === 'github') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12A11.5 11.5 0 0 0 12 .5z" />
      </svg>
    );
  }
  if (name === 'x') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.48l8.6-9.83L0 1.15h7.59l5.24 6.93zm-1.29 19.5h2.04L6.49 3.24H4.3z" />
      </svg>
    );
  }
  return null;
}

/**
 * Accessible modal: Escape to close, backdrop click to close, visible focus
 * ring, and a viewport-height cap so the QR never runs off a short phone screen.
 */
function Modal({ title, onClose, children }) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  const handleKey = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    restoreRef.current = document.activeElement;
    panelRef.current?.focus();
    document.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, [handleKey]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export default function SiteChrome() {
  const [open, setOpen] = useState(null); // 'reward' | 'follow' | null
  const close = useCallback(() => setOpen(null), []);

  return (
    <>
      {/* Secondary affordances, kept as compact icons so they never compete
          with the sequencer for attention. */}
      <div className="site-actions">
        <button
          type="button"
          className="site-btn reward"
          onClick={() => setOpen('reward')}
          aria-label="打赏支持"
          title="打赏支持"
        >
          <Icon name="reward" />
        </button>
        <button
          type="button"
          className="site-btn follow"
          onClick={() => setOpen('follow')}
          aria-label="关注向阳乔木"
          title="关注向阳乔木"
        >
          <Icon name="follow" />
        </button>
        <a
          className="site-btn"
          href={LINKS.github}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          title="GitHub @joeseesun"
        >
          <Icon name="github" />
        </a>
        <a
          className="site-btn"
          href={LINKS.x}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="X"
          title="X @vista8"
        >
          <Icon name="x" />
        </a>
      </div>

      {open === 'reward' && (
        <Modal title={LINKS.reward.title} onClose={close}>
          <img className="modal-qr" src="/reward-qr.png" alt="打赏二维码" width="760" height="760" />
          <p className="modal-note">如果这个小工具帮到了你，欢迎请乔木喝杯咖啡。</p>
        </Modal>
      )}

      {open === 'follow' && (
        <Modal title={LINKS.follow.title} onClose={close}>
          <img
            className="modal-qr"
            src="/wechat-qr.jpg"
            alt="微信公众号「向阳乔木推荐看」二维码"
            width="344"
            height="344"
          />
          <p className="modal-account">微信公众号：{LINKS.wechatAccount}</p>
          <div className="modal-links">
            <a href={LINKS.github} target="_blank" rel="noopener noreferrer">
              <Icon name="github" /> GitHub
            </a>
            <a href={LINKS.x} target="_blank" rel="noopener noreferrer">
              <Icon name="x" /> X
            </a>
            <a href={LINKS.tuijian} target="_blank" rel="noopener noreferrer">
              乔木推荐
            </a>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Footer. The prose here is deliberate: it states concrete, checkable facts
 * (how the sound is made, how timing works, what the export is) so a search
 * engine or an LLM answer can quote something real about this page.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-main">
        <p className="site-footer-lead">
          <strong>AI 鼓机 DR-808</strong> 是一个完全在浏览器里运行的 8 音轨 16 步进鼓机。
          Kick、Snare、闭镲、开镲、Clap、Tom、Rimshot、Crash
          八个音色全部由 Web Audio 的振荡器与噪声滤波实时算法合成，不加载任何采样文件——改一行参数就是改声音本身。
        </p>
        <p className="site-footer-lead">
          时钟不用 <code>setInterval</code> 打拍子。调度器提前 120 毫秒把每个音符换算成
          <code>audioContext.currentTime</code> 上的绝对时刻交给音频硬件，主线程卡顿也不会让节拍漂移；
          Swing 通过加减音程实现，所以再怎么摇摆，小节长度都保持不变。编好的循环可离线重渲染为
          16-bit / 44.1kHz 立体声 WAV 导出。
        </p>
      </div>
      <div className="site-footer-links">
        <a href={LINKS.tuijian} target="_blank" rel="noopener noreferrer" className="tuijian">
          乔木推荐
        </a>
        <a href={LINKS.repo} target="_blank" rel="noopener noreferrer">
          <Icon name="github" /> 源码
        </a>
        <a href={LINKS.x} target="_blank" rel="noopener noreferrer">
          <Icon name="x" /> @vista8
        </a>
        <span className="site-footer-copy">© 2026 向阳乔木</span>
      </div>
    </footer>
  );
}
