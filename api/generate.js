const { GoogleGenAI } = require('@google/genai');

// APIキーは環境変数から自動的に読み込まれます
const ai = new GoogleGenAI({});

/**
 * 献立の提案とレシピの要約を生成するためのサーバーレス関数
 * @param {Object} req - Vercelからのリクエストオブジェクト
 * @param {Object} res - Vercelへのレスポンスオブジェクト
 */
module.exports = async (req, res) => {
    // CORSヘッダーを設定 (セキュリティ上の理由から、必要に応じてオリジンを制限してください)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // OPTIONSメソッドへの対応（プリフライトリクエスト）
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { ingredients, mode, allergens } = req.body;

        if (!ingredients) {
            return res.status(400).json({ message: '食材が入力されていません。' });
        }

        // 構造化された応答のためのJSONスキーマ
        const schema = {
            type: "ARRAY",
            description: "異なるレベルの献立提案のリスト",
            items: {
                type: "OBJECT",
                properties: {
                    "level": {
                        "type": "STRING",
                        "description": "献立のレベル（「究極のズボラ飯 (5分以内)」「手軽・時短献立」「豪華レベルアップ献立」のいずれか）", 
                        "enum": ["究極のズボラ飯 (5分以内)", "手軽・時短献立", "豪華レベルアップ献立"] 
                    },
                    "dishName": { "type": "STRING", "description": "提案する献立の名称" },
                    "description": { "type": "STRING", "description": "献立の魅力や特徴を説明するキャッチーな短い一文" },
                    "recipeSummary": { "type": "STRING", "description": "調理のポイント、節約術、簡単な手順を箇条書きでまとめたHTML（<ul><li>タグを使用）" },
                },
                required: ["level", "dishName", "description", "recipeSummary"]
            }
        };

        let modeInstruction = '';
        if (mode === 'health') {
            modeInstruction = '低カロリー・高タンパクなヘルシー志向で、健康を意識した献立を中心に提案してください。';
        } else if (mode === 'allergy' && allergens) {
            modeInstruction = `アレルギー対応のため、以下の食材は絶対に使用しないでください: ${allergens}。`;
        } else {
            modeInstruction = '一般的な献立で、節約と時短を優先して提案してください。';
        }

        const systemPrompt = `
            あなたは「献立の救世主」AIです。ユーザーの入力食材とモードに基づいて、三つの異なるレベルの献立（究極のズボラ飯、手軽・時短、豪華レベルアップ）を提案してください。
            
            全ての献立において、物価高を意識した**節約**と、忙しい人に向けた**時短**を最優先してください。

            各レベルの提案の制約は以下の通りです:
            
            1. **究極のズボラ飯 (5分以内)**: 貧乏でも安く、手軽にすぐ作れる超手抜き献立の提案。調理時間は最大でも5分以内に収まるようにしてください。火を使わない、またはレンチンのみのレシピを優先してください。
            2. **手軽・時短献立**: 10分〜20分程度で調理が完了する、手軽だが満足度の高い献立を提案してください。
            3. **豪華レベルアップ献立**: 30分程度で、見た目や味が「今日の食卓は豪華！」と感じられるような、少し手間をかけた献立を提案してください。ただし、調理の手間は最小限に抑えてください。
            
            ユーザーの希望する食材は「${ingredients}」です。
            ${modeInstruction}
            
            JSONスキーマに厳密に従って、献立提案をリスト（配列）で返してください。
        `;

        const userPrompt = `食材: ${ingredients}、モード: ${mode}（アレルゲン: ${allergens || 'なし'}）で、上記の3つのレベルに合う献立を提案してください。`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                responseSchema: schema,
            }
        });

        // 応答テキストを解析
        const jsonText = response.text.trim();
        const menuData = JSON.parse(jsonText);

        res.status(200).json({ menuData });

    } catch (error) {
        console.error('Gemini API呼び出し中にエラーが発生しました:', error.message);
        // エラー詳細を返す
        res.status(500).json({ 
            message: `献立生成エラー: Internal Server Error. ${error.message}`,
            error: error.message 
        });
    }
};
