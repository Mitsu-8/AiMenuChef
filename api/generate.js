/**
 * AI献立生成APIエンドポイント
 * この関数は、ユーザーが入力した食材と選択したモードに基づき、
 * Gemini APIを呼び出して、3種類の献立レベル（究極のズボラ飯、手軽・時短献立、ちょっと奮発献立）
 * のレシピをJSON形式で生成します。
 */
async function generateContent(request, response) {
    // APIキーが実行環境から提供されることを想定
    const apiKey = ""; 
    const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=";
    const fetchUrl = GEMINI_API_URL + apiKey;

    // ... (中略：入力検証、プロンプト構築、JSONスキーマ定義は変更なし)

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
            // fetchUrl は既に定義されている
            const fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            };

            console.log(`[Attempt ${attempt + 1}] Calling Gemini API at: ${fetchUrl}`); // デバッグログを追加
            const apiResponse = await fetch(fetchUrl, fetchOptions);

            if (!apiResponse.ok) {
                // エラー応答をテキストとして取得し、詳細をログに出力
                const errorText = await apiResponse.text();
                console.error(`API Error Response Text: ${errorText}`);
                
                // エラー応答がJSON形式であればそれを使い、そうでなければテキストをそのまま使う
                let errorDetail;
                try {
                    errorDetail = JSON.parse(errorText);
                } catch {
                    errorDetail = { message: errorText };
                }

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
