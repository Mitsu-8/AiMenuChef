/**
 * AI献立生成APIエンドポイント
 * この関数は、ユーザーが入力した食材と選択したモードに基づき、
 * Gemini APIを呼び出して、3種類の献立レベル（究極のズボラ飯、手軽・時短献立、ちょっと奮発献立）
 * のレシピをJSON形式で生成します。
 */
async function generateContent(request, response) {
    const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=";
    const apiKey = ""; // APIキーは実行環境で自動的に提供されます

    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    const { ingredients, mode, allergens } = request.body;

    // 1. 入力検証
    if (!ingredients || typeof ingredients !== 'string' || ingredients.trim() === "") {
        return response.status(400).json({ error: '食材 (ingredients) の入力は必須です。' });
    }
    const validModes = ['normal', 'healthy', 'allergy'];
    if (!validModes.includes(mode)) {
        return response.status(400).json({ error: '無効な献立モードです。' });
    }
    if (mode === 'allergy' && (!allergens || typeof allergens !== 'string' || allergens.trim() === "")) {
        return response.status(400).json({ error: 'アレルギー除去モードでは、除去食材 (allergens) の入力は必須です。' });
    }
    
    // 2. プロンプトとシステムインストラクションの構築
    const modeDescription = {
        'normal': '物価高対策と時短を重視し、安価で手軽にできる献立を最優先に考えてください。',
        'healthy': '健康と栄養バランスを重視し、低カロリーで高タンパクな食材や野菜を多く使う献立を提案してください。',
        'allergy': `アレルギーを持つ人が安心して食べられるよう、以下の食材・アレルゲンを完全に除去した献立を提案してください: ${allergens}`
    };

    const systemInstruction = {
        parts: [{ 
            text: `
                あなたはプロの献立アドバイザーです。
                ユーザーが提供した食材と以下のモードに基づき、最適な献立を3種類提案してください。
                
                ---
                献立の評価軸: ${modeDescription[mode]}
                ---

                提案する3種類の献立レベルと要件は以下の通りです:
                1. 究極のズボラ飯: 貧乏でも、手間も時間もかけず、超安価でできる献立。調理時間は10分以内。
                2. 手軽・時短献立: 通常の、手軽に時短でできる献立。調理時間は20分以内。
                3. ちょっと奮発献立: ちょっとだけ手間と食材を使った、満足度の高い献立。調理時間は30分以内。

                献立は必ず以下のJSONスキーマに従い、日本語で回答してください。
            `
        }]
    };
    
    const userQuery = `
        使用したい食材: ${ingredients}
        ${mode === 'allergy' ? `絶対に除去すべき食材: ${allergens}` : ''}
        
        上記の要件と食材に基づき、3種類の献立レベル全てについて、それぞれ1つのレシピをJSON形式で提案してください。
    `;


    // 3. JSONスキーマの定義
    const recipeSchema = {
        type: "OBJECT",
        properties: {
            "recipes": {
                type: "ARRAY",
                description: "提案する3種類の献立（究極のズボラ飯、手軽・時短献立、ちょっと奮発献立）のリスト。",
                items: {
                    type: "OBJECT",
                    properties: {
                        "level": { 
                            type: "STRING", 
                            description: "献立のレベル。以下のいずれかであること: 究極のズボラ飯, 手軽・時短献立, ちょっと奮発献立" 
                        },
                        "dishName": { 
                            type: "STRING", 
                            description: "献立名（料理名）。" 
                        },
                        "description": { 
                            type: "STRING", 
                            description: "献立の簡潔な魅力の説明文。物価高・時短・ヘルシーなどのモードに合わせた説明を入れること。" 
                        },
                        "ingredients": {
                            type: "ARRAY",
                            description: "その料理に必要な主な材料のリスト（調味料を除く）。",
                            items: { type: "STRING" }
                        },
                        "markdown_recipe": { 
                            type: "STRING", 
                            description: "作り方を番号付きリスト（1. 2. 3. ...）形式のMarkdownで記述したもの。必ず日本語でステップバイステップで記述すること。" 
                        }
                    },
                    required: ["level", "dishName", "description", "ingredients", "markdown_recipe"]
                }
            }
        },
        required: ["recipes"]
    };

    // 4. APIペイロードの構築
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        
        // 外部の最新情報を利用するため、Google Search Groundingを有効にする
        tools: [{ "google_search": {} }], 
        
        systemInstruction: systemInstruction,
        
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: recipeSchema,
        }
    };

    // 5. API呼び出しとリトライロジック
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const fetchUrl = GEMINI_API_URL + apiKey;
            const fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            };

            const apiResponse = await fetch(fetchUrl, fetchOptions);

            if (!apiResponse.ok) {
                const errorDetail = await apiResponse.json();
                throw new Error(`API呼び出しエラー: ${apiResponse.status} - ${JSON.stringify(errorDetail)}`);
            }

            const result = await apiResponse.json();

            // 応答の解析
            const candidate = result.candidates?.[0];
            if (candidate && candidate.content?.parts?.[0]?.text) {
                const jsonText = candidate.content.parts[0].text;
                
                try {
                    const parsedJson = JSON.parse(jsonText);
                    // 6. 成功応答
                    return response.status(200).json(parsedJson);
                } catch (e) {
                    console.error('JSONパースエラー:', e);
                    lastError = new Error(`AI応答のJSONパースに失敗しました: ${jsonText}`);
                }
            } else {
                lastError = new Error('AIからの応答に有効な内容が含まれていません。');
            }
        } catch (error) {
            console.error(`Attempt ${attempt + 1} failed:`, error.message);
            lastError = error;
        }

        if (attempt < maxRetries - 1) {
            // 指数関数的バックオフ
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // 7. 失敗応答
    return response.status(500).json({ error: `献立生成に失敗しました。AIからの有効な応答が得られませんでした。（${lastError.message}）` });
}

// Canvas環境でこの関数をエクスポートする
module.exports = generateContent;
