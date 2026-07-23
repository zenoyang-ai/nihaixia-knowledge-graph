// 倪海厦知识图谱 — 典藏分享海报生成器 (高保真典藏级排版)
(function() {
    function generatePoster(node) {
        if (!node) return;

        let overlay = document.getElementById('poster-modal-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'poster-modal-overlay';
            overlay.className = 'poster-modal-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'poster-card-title');
            overlay.innerHTML = `
                <div class="poster-card-box" tabindex="-1">
                    <button type="button" class="poster-close-x" id="poster-close-x" aria-label="关闭">&times;</button>
                    <div class="poster-card-header">
                        <div class="poster-card-title oriental-serif" id="poster-card-title">知识典藏海报</div>
                        <div class="poster-card-sub">微信扫码或保存分享</div>
                    </div>
                    <canvas id="poster-canvas" width="600" height="920" class="poster-canvas-preview"></canvas>
                    <div class="poster-actions">
                        <button class="poster-btn" id="poster-close-btn">关闭</button>
                        <button class="poster-btn poster-btn-primary" id="poster-download-btn">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            保存图片
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const closePoster = () => {
                overlay.classList.remove('active');
                document.documentElement.style.overflow = '';
                document.body.style.overflow = '';
                document.removeEventListener('keydown', onPosterKey);
                if (overlay._prevFocus && overlay._prevFocus.focus) {
                    try { overlay._prevFocus.focus(); } catch (e) {}
                }
            };
            const onPosterKey = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closePoster();
                }
            };
            overlay._closePoster = closePoster;
            overlay._onPosterKey = onPosterKey;

            overlay.querySelector('#poster-close-btn').addEventListener('click', closePoster);
            overlay.querySelector('#poster-close-x').addEventListener('click', closePoster);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closePoster();
            });
            overlay.querySelector('#poster-download-btn').addEventListener('click', () => {
                const canvas = document.getElementById('poster-canvas');
                const link = document.createElement('a');
                const titleForFile = (window.currentNodeData && window.currentNodeData.title) || '节点';
                link.download = `倪海厦知识图谱-${titleForFile}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
            });
        }

        overlay._prevFocus = document.activeElement;
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', overlay._onPosterKey);

        // Safari < 15 等环境可能没有 roundRect
        if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
            CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
                const r = typeof radii === 'number' ? radii : (Array.isArray(radii) ? radii[0] : 0);
                const rr = Math.min(r, w / 2, h / 2);
                this.moveTo(x + rr, y);
                this.arcTo(x + w, y, x + w, y + h, rr);
                this.arcTo(x + w, y + h, x, y + h, rr);
                this.arcTo(x, y + h, x, y, rr);
                this.arcTo(x, y, x + w, y, rr);
                this.closePath();
            };
        }

        const canvas = overlay.querySelector('#poster-canvas');
        const ctx = canvas.getContext('2d');
        const W = 600;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        const TITLE_SIZE = 50;
        const SUMMARY_SIZE = 24;
        const QUOTE_SIZE = 20;
        const PADDING = 44; // 优雅的边距

        // Canvas 不渲染 Markdown：去掉 ** __ ` # [[wikilink]] 列表符等，只留纯文本
        function stripMarkdown(text) {
            return String(text || '')
                .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, path, alias) => {
                    if (alias) return alias;
                    return path.split('/').pop().replace(/\.md$/i, '');
                })
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                .replace(/__([^_]+)__/g, '$1')
                .replace(/\*([^*\n]+)\*/g, '$1')
                .replace(/_([^_\n]+)_/g, '$1')
                .replace(/`([^`]+)`/g, '$1')
                .replace(/^#{1,6}\s+/gm, '')
                .replace(/^[-*•]\s+/gm, '')
                .replace(/[*#`]/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        // 收集要展示的文本内容
        const title = node.title || '知识节点';
        const layerTag = node.layer || '经典概念';
        const summary = stripMarkdown(
            node.definition || node.summary || '中医经典知识总结，理法方药兼备，由倪海厦老师系统讲授。'
        );

        let coreText = '';
        if (node.sections && node.sections['核心理解']) {
            coreText = stripMarkdown(node.sections['核心理解']).replace(/\n{2,}/g, '\n');
        }

        let quoteText = '';
        if (node.quotes && node.quotes.length > 0) {
            const q = node.quotes[0];
            quoteText = stripMarkdown(typeof q === 'object' ? (q.text || q.quote || '') : String(q));
        }

        // ── 测算高度与换行 ──
        ctx.font = `${SUMMARY_SIZE}px "Songti SC", "Noto Serif SC", serif`;

        function measureWrap(text, maxWidth, lineHeight, paraGap) {
            if (!text) return 0;
            const gap = paraGap || 0;
            const paras = text.split('\n').filter(p => p.trim());
            let total = 0;
            paras.forEach((para, idx) => {
                let line = '';
                let lines = 1;
                for (let ch of para) {
                    let test = line + ch;
                    if (ctx.measureText(test).width > maxWidth && line.length) {
                        line = ch; lines++;
                    } else { line = test; }
                }
                total += lines * lineHeight;
                if (idx < paras.length - 1) total += gap;
            });
            return total;
        }

        const PARA_GAP = 8;
        const contentWidth = W - (PADDING * 2);
        
        let currentY = PADDING + 60; // 头部留白 + 落款
        currentY += 40; // 分隔线距离

        // 标题与 Badge
        currentY += TITLE_SIZE + 10;
        currentY += 28 + 24; // Badge + 间距

        // 摘要
        currentY += measureWrap(summary, contentWidth, 38, 0) + 24;

        // 核心理解 / 倪师原话
        if (quoteText) {
            const boxInnerH = measureWrap(quoteText, contentWidth - 32, 32, 0);
            currentY += boxInnerH + 50 + 28;
        } else if (coreText) {
            const truncatedCore = coreText.length > 180
                ? coreText.slice(0, 180).replace(/[^。！？\n]*$/, '') + '…'
                : coreText;
            const boxInnerH = measureWrap(truncatedCore, contentWidth - 32, 32, PARA_GAP);
            currentY += boxInnerH + 46 + 28;
        }

        const footerH = 140;
        const H = Math.max(560, Math.min(980, currentY + footerH));
        canvas.height = H;
        canvas.width = W;

        // ── 1. 画布背景 ──
        ctx.fillStyle = isDark ? '#141210' : '#fcf8f2';
        ctx.fillRect(0, 0, W, H);

        // 单层精致边框 (摒弃多重边框)
        ctx.strokeStyle = isDark ? 'rgba(192, 57, 43, 0.35)' : 'rgba(192, 57, 43, 0.22)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(20, 20, W - 40, H - 40);

        // 四角装饰纹 (东方云角意象)
        ctx.strokeStyle = isDark ? '#c0392b' : '#b9362c';
        ctx.lineWidth = 3;
        const cornerL = 16;
        // 左上
        ctx.beginPath(); ctx.moveTo(20, 20 + cornerL); ctx.lineTo(20, 20); ctx.lineTo(20 + cornerL, 20); ctx.stroke();
        // 右上
        ctx.beginPath(); ctx.moveTo(W - 20 - cornerL, 20); ctx.lineTo(W - 20, 20); ctx.lineTo(W - 20, 20 + cornerL); ctx.stroke();
        // 左下
        ctx.beginPath(); ctx.moveTo(20, H - 20 - cornerL); ctx.lineTo(20, H - 20); ctx.lineTo(20 + cornerL, H - 20); ctx.stroke();
        // 右下
        ctx.beginPath(); ctx.moveTo(W - 20 - cornerL, H - 20); ctx.lineTo(W - 20, H - 20); ctx.lineTo(W - 20, H - 20 - cornerL); ctx.stroke();

        // ── 2. 标头落款 ──
        ctx.fillStyle = isDark ? '#e74c3c' : '#c0392b';
        ctx.font = 'bold 20px "Songti SC", "Noto Serif SC", serif';
        ctx.fillText('倪海厦知识图谱 · 典藏卡', PADDING, 58);

        ctx.fillStyle = isDark ? '#8a7d6e' : '#8c7f70';
        ctx.font = '12px sans-serif';
        ctx.fillText('NI HAIXIA KNOWLEDGE ATLAS', PADDING, 78);

        ctx.strokeStyle = isDark ? 'rgba(192, 57, 43, 0.3)' : 'rgba(192, 57, 43, 0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PADDING, 94);
        ctx.lineTo(W - PADDING, 94);
        ctx.stroke();

        // ── 3. 节点标题 ──
        ctx.fillStyle = isDark ? '#f2e6d6' : '#1a1612';
        ctx.font = `bold ${TITLE_SIZE}px "Songti SC", "Noto Serif SC", serif`;
        ctx.fillText(title, PADDING, 156);

        // ── 4. 胶囊 Badge ──
        ctx.font = 'bold 13px sans-serif';
        const badgeW = ctx.measureText(layerTag).width + 24;
        const badgeH = 26;
        const badgeX = PADDING;
        const badgeY = 176;
        
        // 圆角胶囊
        ctx.fillStyle = isDark ? 'rgba(231, 76, 60, 0.2)' : 'rgba(192, 57, 43, 0.1)';
        ctx.strokeStyle = isDark ? '#e74c3c' : '#c0392b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 13);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isDark ? '#e74c3c' : '#c0392b';
        ctx.textAlign = 'center';
        ctx.fillText(layerTag, badgeX + badgeW / 2, badgeY + 17);
        ctx.textAlign = 'left';

        // ── 5. 摘要渲染 ──
        function wrapText(context, text, x, y, maxWidth, lineHeight, paraGap) {
            if (!text) return y;
            const gap = paraGap || 0;
            const paras = text.split('\n').filter(p => p.trim());
            let drawY = y;
            paras.forEach((para, idx) => {
                let line = '';
                for (const ch of para) {
                    let test = line + ch;
                    if (context.measureText(test).width > maxWidth && line.length) {
                        context.fillText(line, x, drawY);
                        line = ch;
                        drawY += lineHeight;
                    } else { line = test; }
                }
                context.fillText(line, x, drawY);
                if (idx < paras.length - 1) {
                    drawY += lineHeight + gap;
                } else {
                    drawY += lineHeight;
                }
            });
            return drawY;
        }

        ctx.fillStyle = isDark ? '#c8bcac' : '#383028';
        ctx.font = `${SUMMARY_SIZE}px "Songti SC", "Noto Serif SC", serif`;
        let renderY = wrapText(ctx, summary, PADDING, 242, contentWidth, 38, 0);

        // ── 6. 核心理解 / 倪师原话区块 ──
        if (quoteText) {
            renderY += 24;
            ctx.font = `${QUOTE_SIZE}px "Songti SC", "Noto Serif SC", serif`;
            const boxInnerH = measureWrap(quoteText, contentWidth - 32, 32, 0);
            const boxH = boxInnerH + 46;

            ctx.fillStyle = isDark ? 'rgba(231, 76, 60, 0.08)' : 'rgba(192, 57, 43, 0.04)';
            ctx.fillRect(PADDING, renderY, contentWidth, boxH);
            ctx.fillStyle = isDark ? '#e74c3c' : '#c0392b';
            ctx.fillRect(PADDING, renderY, 3.5, boxH);

            ctx.fillStyle = isDark ? '#e74c3c' : '#c0392b';
            ctx.font = 'bold 15px serif';
            ctx.fillText('【 倪师原话 】', PADDING + 16, renderY + 24);

            ctx.fillStyle = isDark ? '#a4c2f4' : '#1c3d5a';
            ctx.font = `italic ${QUOTE_SIZE}px serif`;
            wrapText(ctx, `"${quoteText}"`, PADDING + 16, renderY + 54, contentWidth - 32, 32, 0);
        } else if (coreText) {
            renderY += 24;
            const truncatedCore = coreText.length > 180
                ? coreText.slice(0, 180).replace(/[^。！？\n]*$/, '') + '…'
                : coreText;
            ctx.font = `${QUOTE_SIZE}px "Songti SC", "Noto Serif SC", serif`;
            const boxInnerH = measureWrap(truncatedCore, contentWidth - 32, 32, PARA_GAP);
            const boxH = boxInnerH + 46;

            ctx.fillStyle = isDark ? 'rgba(231, 76, 60, 0.08)' : 'rgba(192, 57, 43, 0.04)';
            ctx.fillRect(PADDING, renderY, contentWidth, boxH);
            ctx.fillStyle = isDark ? '#e74c3c' : '#c0392b';
            ctx.fillRect(PADDING, renderY, 3.5, boxH);

            ctx.fillStyle = isDark ? '#e74c3c' : '#c0392b';
            ctx.font = 'bold 15px serif';
            ctx.fillText('【 核心理解 】', PADDING + 16, renderY + 24);

            ctx.fillStyle = isDark ? '#c8bcac' : '#383028';
            ctx.font = `${QUOTE_SIZE}px "Songti SC", "Noto Serif SC", serif`;
            wrapText(ctx, truncatedCore, PADDING + 16, renderY + 54, contentWidth - 32, 32, PARA_GAP);
        }

        // ── 7. 底部落款与二维码 ──
        const separatorY = H - footerH;
        ctx.strokeStyle = isDark ? 'rgba(192, 57, 43, 0.3)' : 'rgba(192, 57, 43, 0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PADDING, separatorY);
        ctx.lineTo(W - PADDING, separatorY);
        ctx.stroke();

        const qrImg = new Image();
        qrImg.crossOrigin = 'anonymous';
        qrImg.onload = function() {
            const qrSize = 76;
            const qrX = W - PADDING - qrSize;
            const qrY = separatorY + 20;

            // 二维码绘制加白/暗色软边框背景
            ctx.fillStyle = isDark ? '#1e1a16' : '#ffffff';
            ctx.strokeStyle = isDark ? 'rgba(192, 57, 43, 0.25)' : 'rgba(192, 57, 43, 0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 6);
            ctx.fill();
            ctx.stroke();

            ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

            // 底部文字只占左侧区域
            const textX = PADDING;
            ctx.fillStyle = isDark ? '#f0e6d8' : '#1a1612';
            ctx.font = 'bold 15px "Songti SC", "Noto Serif SC", serif';
            ctx.fillText('微信公众号：「数字问渡」', textX, qrY + 22);

            ctx.fillStyle = isDark ? '#8a7d6e' : '#7a6b5a';
            ctx.font = '12px sans-serif';
            ctx.fillText('扫码学习倪海厦中医', textX, qrY + 44);
            ctx.fillText('与天纪知识体系', textX, qrY + 62);

            overlay.classList.add('active');
            const focusEl = overlay.querySelector('#poster-download-btn') || overlay.querySelector('.poster-card-box');
            setTimeout(() => focusEl && focusEl.focus(), 40);
        };
        qrImg.onerror = function() {
            overlay.classList.add('active');
            const focusEl = overlay.querySelector('#poster-close-btn') || overlay.querySelector('.poster-card-box');
            setTimeout(() => focusEl && focusEl.focus(), 40);
        };
        qrImg.src = 'assets/qrcode-digital-wendu.jpg';
    }

    window.generatePoster = generatePoster;
})();
