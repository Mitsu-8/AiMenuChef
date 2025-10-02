const { GoogleGenAI } = require('@google/genai');

// APIキーは環境変数から自動的に読み込まれます
const ai = new GoogleGenAI({});

/**
 * 詳細レシピと分量を生成するためのサーバーレス関数
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
        const { dishName, ingredients, mode } = req.body;

        if (!dishName || !ingredients) {
            return res.status(400).json({ message: '献立名と主要食材が必要です。' });
        }

        const modeDescription = {
            'normal': '通常の献立',
            'health': '低カロリー・高タンパクなヘルシー献立',
            'allergy': '特定食材を除去した献立',
            // 他のモードも必要に応じて追加
        }[mode] || '一般的な献立';

        // 構造化された応答のためのJSONスキーマ
        const schema = {
            type: "OBJECT",
            properties: {
                // dishNameは元のものをそのまま利用
                "dishName": { "type": "STRING", "description": "献立の正式名称" },
                "yield": { "type": "STRING", "description": "何人分のレシピか（例: 2人分）" },
                "totalTime": { "type": "STRING", "description": "調理にかかるおおよその時間（例: 25分）" },
                "ingredientsList": {
                    "type": "ARRAY",
                    "description": "具体的な分量を含む材料リスト",
                    "items": { "type": "STRING", "description": "材料名と分量（例: 鶏むね肉 200g, 醤油 大さじ2）" }
                },
                "instructions": {
                    "type": "ARRAY",
                    "description": "番号付きの具体的な調理手順",
                    "items": { "type": "STRING", "description": "調理手順（例: 鶏むね肉を一口大に切り、下味をつける。）" }
                },
            },
            required: ["dishName", "yield", "totalTime", "ingredientsList", "instructions"]
        };

        const systemPrompt = `
            あなたは献立名：「${dishName}」の詳細レシピを作成するプロの料理研究家です。
            以下の制約に従って、詳細なレシピを日本語でJSON形式で生成してください。
            1. 分量は「2人分」を基準として具体的なグラム数や大さじなどで記載してください。
            2. 調理手順(instructions)は、分かりやすく具体的なステップをリスト形式で作成し、各ステップは一つずつ独立させてください。
            3. この献立は「${modeDescription}」のコンセプトと、食材「${ingredients}」を使用することを考慮してください。
            4. 物価高を考慮し、安価な食材や節約調理法を優先的に提案してください。
        `;

        const userPrompt = `献立名：「${dishName}」のレシピを、JSONスキーマに従って生成してください。`;

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
        const detailRecipe = JSON.parse(jsonText);

        res.status(200).json({ detailRecipe });

    } catch (error) {
        console.error('Gemini API呼び出し中にエラーが発生しました:', error.message);
        res.status(500).json({ 
            message: `詳細レシピ生成エラー: Internal Server Error. ${error.message}`,
            error: error.message 
        });
    }
};
