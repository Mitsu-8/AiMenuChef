/**
 * Vercel Serverless Function (Node.js) のエントリーポイント
 * * この関数は、献立 AI シェフ (index.html) からの POST リクエストを受け取り、
 * Google Gemini APIを呼び出して献立の提案をJSON形式で返します。
 * * Vercelの環境変数 GEMINI_API_KEY を使用します。
 */

// Vercelで設定された環境変数からAPIキーを読み込む
// 🚨 以前の動作していた頃の設定に戻し、process.envからAPIキーを確実に取得します。
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
                description: "献立レベル。以下の3つのいずれか: '究極のズボラ飯', '手軽・時短献立', 'ちょっと奮発献立'。" 
            },
            "dishName": { 
                type: "STRING", 
                description: "献立のメインの料理名（例: 鶏むね肉と野菜の和風炒め）。" 
            },
            "dishDescription": { 
                type: "STRING", 
                description: "献立の魅力的な説明文。価格高騰を意識した節約献立であることを強調すること。" 
            },
            "requiredIngredients": { 
                type: "STRING", 
                description: "この料理を作るために最低限必要な主な食材リスト（例: 鶏むね肉、玉ねぎ、キャベツ、醤油）。" 
            },
            "markdown_recipe": { 
                type: "STRING", 
                description: "料理の作り方。PCやスマホで非常に見やすいように、必ず番号付きリスト（1. 2. 3. ...）形式のMarkdownで記述すること。" 
            }
        },
        required: ["level", "dishName", "dishDescription", "requiredIngredients", "markdown_recipe"]
    }
};


// Vercelサーバーレス関数のエントリーポイント
module.exports = async (req, res) => {
    // POSTリクエストのみを処理
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // 必須データの確認
    const { ingredients, mode, allergens } = req.body;

    if (!ingredients || !mode) {
        return res.status(400).json({ error: '食材とモードは必須です。' });
    }

    try {
        if (!GEMINI_API_KEY) {
            console.error("GEMINI_API_KEYが設定されていません。");
            // APIキーがない場合は 500 エラーを返す
            return res.status(500).json({ error: 'サーバー設定エラー: APIキーが設定されていません。' });
        }

        // 献立レベルと制約の決定
        let userConstraint = `使いたい食材: ${ingredients}。`;
        let systemInstruction = "あなたは物価高を意識した献立提案のプロフェッショナルなシェフです。国民の手取りが上がらない現状を考慮し、提案するすべての献立は**最大限に安価な食材で、手間をかけずに作れること**を最優先してください。";
        
        switch (mode) {
            case 'normal':
                userConstraint += "モード: 通常。";
                break;
            case 'healthy':
                userConstraint += "モード: ヘルシー（高タンパク、低脂質、低カロリーになるように考慮してください）。";
                systemInstruction += "特に、提案する献立はカロリーと脂質を抑えたヘルシーな内容であることを強調してください。";
                break;
            case 'allergy':
                if (allergens) {
                    userConstraint += `モード: アレルギー除去。**これらの食材は絶対に使用しないでください: ${allergens}**。`;
                    systemInstruction += `提案する献立は、ユーザーが指定したアレルゲン（${allergens}）を**絶対に使用しない**ことを保証してください。`;
                } else {
                    return res.status(400).json({ error: 'アレルギー除去モードでは、除去する食材の指定が必要です。' });
                }
                break;
            default:
                userConstraint += "モード: 通常。";
        }
        
        // ユーザープロンプトの構築
        const userPrompt = `${userConstraint}

以下の3つのレベルに沿った献立を、上から順番に提案してください。
1. **究極のズボラ飯**: 貧乏でも、手間も時間もかけず、超安価でできる献立。
2. **手軽・時短献立**: 通常の、手軽に時短でできる献立。
3. **ちょっと奮発献立**: ちょっとだけ手間と食材を使った、満足度の高い献立。

**作り方 (markdown_recipe) は、必ず番号付きリスト (1. 2. 3. ...) 形式のMarkdownで記述してください。**`;


        // APIペイロードの構築
        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            // 外部検索（Google Search Grounding）を有効化し、献立の実行可能性を高めます
            tools: [{ "google_search": {} }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: { 
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
            console.error("Gemini API Error Response:", errorText);
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
        console.error("サーバーレス関数実行エラー:", error.message);
        // エラー詳細をフロントエンドに返さないように、一般的なエラーメッセージを返す
        res.status(500).json({ error: `献立生成中にサーバーエラーが発生しました。詳細: ${error.message}` });
    }
};
