// ローカルストレージで使用するキー名
const STORAGE_KEY_API = 'ai_diary_api_key';
const STORAGE_KEY_HISTORY = 'ai_diary_history';

// ==========================================
// 1. APIキーの管理
// ==========================================
function getApiKey() {
    return localStorage.getItem(STORAGE_KEY_API) || '';
}

function setApiKey(key) {
    localStorage.setItem(STORAGE_KEY_API, key);
}

function clearApiKey() {
    localStorage.removeItem(STORAGE_KEY_API);
}

// ==========================================
// 2. モーダル表示の管理
// ==========================================
function showModal() {
    const modal = document.getElementById('api-key-modal');
    const input = document.getElementById('api-key-input');
    const deleteBtn = document.getElementById('modal-delete-btn');

    // 現在保存されているキーを表示
    const currentKey = getApiKey();
    input.value = currentKey;

    // キーが保存されていなければ「削除」ボタンを隠す
    deleteBtn.style.display = currentKey ? 'inline-block' : 'none';

    modal.style.display = 'flex';
}

function hideModal() {
    document.getElementById('api-key-modal').style.display = 'none';
}

// ==========================================
// 3. 履歴データの管理
// ==========================================
function loadHistory() {
    const data = localStorage.getItem(STORAGE_KEY_HISTORY);
    return data ? JSON.parse(data) : [];
}

function saveHistory(historyArray) {
    // 最大20件に制限して保存
    const limitedHistory = historyArray.slice(0, 20);
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(limitedHistory));
}

// ==========================================
// 4. Gemini APIの呼び出し処理
// ==========================================
async function callGemini(text, apiKey) {
    try {
        // --- 1. まず利用可能なモデル一覧を取得し、ログに出力 ---
        const modelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const modelsRes = await fetch(modelsUrl);
        if (!modelsRes.ok) {
            const errText = await modelsRes.text();
            console.error("Models API エラー詳細:", modelsRes.status, errText);
            throw new Error(`モデル一覧の取得に失敗しました(${modelsRes.status})。詳細をコンソールで確認してください。`);
        }
        const modelsData = await modelsRes.json();
        console.log("利用可能なモデル一覧:", modelsData);

        // --- 2. テキスト生成に対応したモデルをリストから選ぶ ---
        let selectedModelName = null;
        for (const model of modelsData.models) {
            if (model.supportedGenerationMethods && model.supportedGenerationMethods.includes("generateContent")) {
                // できれば "gemini-1.5-flash" 等を優先
                if (model.name.includes("gemini-1.5-flash")) {
                    selectedModelName = model.name;
                    break;
                }
            }
        }
        // 見つからなかった場合はリスト内の最初の text 生成モデルを使用
        if (!selectedModelName) {
            const firstAvailable = modelsData.models.find(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"));
            if (firstAvailable) {
                selectedModelName = firstAvailable.name;
            } else {
                throw new Error("テキスト生成に対応したモデルが見つかりませんでした。");
            }
        }

        console.log("実際に呼び出すモデル:", selectedModelName);

        // --- 3. 選択したモデルのエンドポイントで生成APIを呼び出す ---
        const url = `https://generativelanguage.googleapis.com/v1beta/${selectedModelName}:generateContent?key=${apiKey}`;

        const prompt = `あなたは優しいAIの友人です。以下のユーザーの日記に対して、1〜3文の短く優しい日本語で返信を作成してください。また、日記から読み取れる感情を判定してください。
出力は必ず以下のJSONフォーマットのみにしてください（マークダウンのコードブロック等の装飾は一切不要です）。
{ "reaction": "返信テキスト", "sentiment": "positive" もしくは "neutral" もしくは "negative" もしくは "sad" もしくは "angry" }

日記: ${text}`;

        const requestBody = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json" // JSON形式での返却を強制
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("Generate API エラー詳細:", response.status, errText);

            if (response.status === 400) throw new Error("APIキーが無効、またはリクエストが不正です。コンソールを確認してください。");
            if (response.status === 403) throw new Error("APIへのアクセスが拒否されました。");
            if (response.status === 404) throw new Error(`モデルのエンドポイントが見つかりません(404)。コンソールのエラー詳細を確認してください。`);
            throw new Error(`APIエラー (${response.status}): しばらく経ってからお試しください。`);
        }

        const data = await response.json();
        const responseText = data.candidates[0].content.parts[0].text;

        // JSONをパース（Geminiが時折不要な文字を含めた場合に備えてクリーンアップ）
        const cleansedText = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
        const result = JSON.parse(cleansedText);

        return {
            reply: result.reaction,
            emotion: result.sentiment
        };

    } catch (error) {
        // fetchが失敗した場合（ネットワーク切断、CORSブロックなど）
        if (error instanceof TypeError) {
            console.error("Network or CORS Error:", error);
            throw new Error("通信に失敗しました。ブラウザから直接API呼び出しがブロックされたか（CORS制約）、ネットワーク接続がありません。解決するにはサーバーを経由する方式か、正しいAPI設定が必要です。");
        }
        throw error; // その他のエラーはそのまま投げる
    }
}

// ==========================================
// 5. 画面の初期化とイベント設定
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // UI要素の取得
    const diaryInput = document.getElementById('diary-input');
    const charCount = document.getElementById('char-count');
    const generateBtn = document.getElementById('generate-btn');

    const resultSection = document.getElementById('result-section');
    const emotionBadge = document.getElementById('emotion-badge');
    const loadingIndicator = document.getElementById('loading-indicator');
    const aiReply = document.getElementById('ai-reply');
    const errorMessage = document.getElementById('error-message');

    const historyList = document.getElementById('history-list');
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    const settingsBtn = document.getElementById('settings-btn');

    const modalSaveBtn = document.getElementById('modal-save-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalDeleteBtn = document.getElementById('modal-delete-btn');
    const apiKeyInput = document.getElementById('api-key-input');

    // 初期化処理：履歴を画面に表示
    renderHistory();

    // 入力文字数のカウントとボタン制御
    diaryInput.addEventListener('input', () => {
        const count = diaryInput.value.length;
        charCount.textContent = `${count} 文字`;
        generateBtn.disabled = count === 0;
    });

    generateBtn.disabled = true;

    // 「送信してAIの反応を見る」ボタンの処理
    generateBtn.addEventListener('click', async () => {
        const content = diaryInput.value.trim();
        if (!content) return;

        // 1. APIキーの確認
        const apiKey = getApiKey();
        if (!apiKey) {
            showModal(); // キーがない場合はモーダルを表示して処理を中断
            return;
        }

        // 2. UIをローディング状態に変更
        generateBtn.disabled = true;
        resultSection.style.display = 'block';
        loadingIndicator.style.display = 'flex';
        aiReply.style.display = 'none';
        errorMessage.style.display = 'none';
        emotionBadge.textContent = '分析中...';
        emotionBadge.className = 'emotion-badge';
        document.body.className = ''; // 背景テーマリセット

        try {
            // 3. Gemini API呼び出し
            const result = await callGemini(content, apiKey);

            // 4. 成功時のUI更新
            loadingIndicator.style.display = 'none';
            aiReply.style.display = 'block';
            aiReply.textContent = result.reply;

            emotionBadge.textContent = getEmotionLabel(result.emotion);
            emotionBadge.className = `emotion-badge ${result.emotion}`;

            // 背景テーマの変更
            document.body.className = `theme-${result.emotion}`;

            // 5. 履歴データとして保存
            const historyData = loadHistory();
            const newItem = {
                id: Date.now(),
                date: new Date().toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
                content: content,
                reply: result.reply,
                emotion: result.emotion
            };
            historyData.unshift(newItem); // リストの先頭に追加
            saveHistory(historyData);

            // 履歴一覧を再描画
            renderHistory();

            // 入力欄のみリセット
            diaryInput.value = '';
            charCount.textContent = '0 文字';

        } catch (error) {
            // 失敗時のUI更新
            loadingIndicator.style.display = 'none';
            errorMessage.style.display = 'block';
            // エラーメッセージの中に再度モーダルを開くボタンを配置
            errorMessage.innerHTML = `${error.message}<br><button onclick="window.showModal()" style="margin-top:0.75rem; text-decoration:underline; background:none; border:none; color:inherit; cursor:pointer; font-weight:bold;">⚙️ API設定を開く</button>`;

            emotionBadge.textContent = 'エラー';
            emotionBadge.className = 'emotion-badge negative';
        } finally {
            // 入力があればボタンを再度有効化
            if (diaryInput.value.trim().length > 0) {
                generateBtn.disabled = false;
            }
        }
    });

    // === モーダル関連のイベント ===
    // HTMLからのonclick属性で呼べるようにグローバルに登録（エラーメッセージの中からのクリック用）
    window.showModal = showModal;

    settingsBtn.addEventListener('click', showModal);
    modalCancelBtn.addEventListener('click', hideModal);

    // キーを保存
    modalSaveBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            setApiKey(key);
            hideModal();
            alert('APIキーを保存しました。');
        } else {
            alert('APIキーを入力してください。');
        }
    });

    // キーを削除
    modalDeleteBtn.addEventListener('click', () => {
        if (confirm('保存されているAPIキーを削除し、機能を無効化しますか？')) {
            clearApiKey();
            hideModal();
            alert('APIキーを削除しました。');
        }
    });

    // モーダルの背景（黒い半透明部分）をクリックしても閉じる
    document.querySelector('.modal-overlay').addEventListener('click', hideModal);

    // === 履歴クリア ===
    clearHistoryBtn.addEventListener('click', () => {
        if (confirm('本当に全ての履歴を削除しますか？')) {
            localStorage.removeItem(STORAGE_KEY_HISTORY);
            renderHistory();
        }
    });

    // 感情の英語文字列を日本語表示に変換するヘルパー
    function getEmotionLabel(emotion) {
        switch (emotion) {
            case 'positive': return 'ハッピー 🌸';
            case 'neutral': return 'ニュートラル 💡';
            case 'negative': return '寄り添い ☂️';
            case 'sad': return '悲しい 💧';
            case 'angry': return '怒り 💢';
            default: return '不明';
        }
    }

    // 履歴データを画面上に描画する
    function renderHistory() {
        const historyData = loadHistory();
        historyList.innerHTML = '';

        if (historyData.length === 0) {
            historyList.innerHTML = `<div class="empty-state">履歴はありません。</div>`;
            return;
        }

        historyData.forEach(item => {
            const article = document.createElement('article');
            article.className = `history-item ${item.emotion}`;

            article.innerHTML = `
                <div class="history-meta">
                    <span class="history-date">${item.date}</span>
                    <span class="emotion-badge ${item.emotion}">${getEmotionLabel(item.emotion)}</span>
                </div>
                <div class="history-content">${item.content}</div>
                <div class="history-reply">${item.reply}</div>
            `;

            historyList.appendChild(article);
        });
    }
});
