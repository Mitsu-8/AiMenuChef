/**
 * Vercel Serverless Function (Node.js) のエントリーポイント
 * * この関数は、献立 AI シェフ (index.html) からの POST リクエストを受け取り、
 * Google Gemini APIを呼び出して献立の提案をJSON形式で返します。
 * * Vercelの環境変数に GEMINI_API_KEY を設定する必要があります。
 */

// Vercelで設定された環境変数からAPIキーを読み込む
// 🚨 注意: この環境では process.env は使用できませんが、Vercelデプロイ用に記述します。
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;

// 献立のJSONスキーマ定義: 3つの献立レベルの配列を返すことをモデルに保証させる
const responseSchema = {
    type: "ARRAY",
    items: {
        type: "OBJECT",
        properties: {
            "level": { 
                type: "STRING", 
                description: "献立レベル。以下の3つのいずれか: '無料シンプル操作', 'ちょっと凝ったもの', '課金レベル'。" 
            },
            "dishName": { 
                type: "STRING", 
                description: "献立のメインの料理名（例: 鶏むね肉と野菜の和風炒め）" 
            },
            "description": { 
                type: "STRING", 
                description: "献立の簡潔な説明（例: 時短・ヘルシー、豪華な一品など）" 
            },
            "recipeSummary": { 
                type: "STRING", 
                description: "レシピの簡単調理のポイント、目安調理時間、重要事項などを箇条書きにしたサマリー。HTMLの <ul><li>...</li></ul> タグを使用すること。" 
            }
        },
        required: ["level", "dishName", "description", "recipeSummary"],
        propertyOrdering: ["level", "dishName", "description", "recipeSummary"]
    }
};

/**
 * サーバーレス機能のエントリポイント (Vercel向け)
 * @param {object} req - HTTPリクエストオブジェクト (ボディに ingredients, mode, allergens を含む)
 * @param {object} res - HTTPレスポンスオブジェクト
 */
module.exports = async (req, res) => {
    // APIキーがない場合はエラーを返す
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ 
            error: "Internal Server Error", 
            message: "APIキーが設定されていません。Vercel環境変数に 'GEMINI_API_KEY' を設定してください。"
        });
    }

    // POSTメソッド以外は許可しない
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            error: "Method Not Allowed", 
            message: "POSTリクエストのみを受け付けます。" 
        });
    }

    try {
        const { ingredients, mode, allergens } = req.body;

        if (!ingredients) {
            return res.status(400).json({ 
                error: "Bad Request", 
                message: "食材の入力が必要です。" 
            });
        }
        
        // システムインストラクションの構築
        let systemInstruction = `あなたは世界最高の献立AIシェフです。ユーザーから提供された食材、モード、制約条件に従い、以下の3つの異なる献立レベルの提案をJSON形式の配列で正確に生成してください。
        
        献立レベルは、必ず '無料シンプル操作', 'ちょっと凝ったもの', '課金レベル' の3つ全てを提案してください。
        
        - '無料シンプル操作': 5分から15分程度の超時短、最も簡単な調理工程で、冷蔵庫の残り物も使い切る現実的な献立を提案してください。
        - 'ちょっと凝ったもの': 20分から30分程度の調理時間で、見た目や味に「ひと工夫」を加えた、家族やゲストも喜ぶ献立を提案してください。
        - '課金レベル': 豪華さ、専門的な知識、栄養バランスの最適解など、高度な付加価値を持たせた特別で魅力的な献立を提案してください。

        各献立の『調理のポイント』(`recipeSummary`)は、**HTMLの箇条書きタグ `<ul><li>...</li></ul>`** を使用して、具体的な手順と重要事項を記載してください。`;
        
        // アレルギーモードの制約を追加
        if (mode === 'allergy' && allergens) {
            systemInstruction += `\n\n【最重要制約】提案するすべての献立は、ユーザーが指定したアレルゲン **${allergens}** を含む食材や調味料を完全に排除しなければなりません。AIの提案が原因で健康被害が発生しないよう、細心の注意を払ってください。`;
        }
        
        // ユーザープロンプト
        const userPrompt = `現在のモード: ${mode}
使用したい食材: ${ingredients}
${mode === 'allergy' && allergens ? `除去すべきアレルゲン: ${allergens}` : ''}

上記の条件に基づき、3つのレベルの献立提案をJSON形式でお願いします。`;


        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            config: {
                // モデルに対してJSON形式での出力を指示
                responseMimeType: "application/json",
                responseSchema: responseSchema,
                temperature: 0.8, 
            }
        };

        // Gemini APIを呼び出し
        const apiResponse = await fetch(API_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            throw new Error(`Gemini API呼び出し中にエラーが発生しました: ${apiResponse.status} - ${errorText.substring(0, 100)}...`);
        }

        const apiResult = await apiResponse.json();
        
        const jsonText = apiResult.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!jsonText) {
             throw new Error("APIレスポンスからJSONテキストを抽出できませんでした。");
        }
        
        // JSON文字列をパース
        const menuData = JSON.parse(jsonText);
        
        // 成功レスポンスをフロントエンドに返す
        res.status(200).json({ menuData: menuData });

    } catch (error) {
        console.error("サーバーレス機能の処理エラー:", error);
        // エラー詳細をクライアントに返す
        res.status(500).json({ 
            error: "Internal Server Error", 
            message: `献立生成処理中にエラーが発生しました: ${error.message}` 
        });
    }
};
