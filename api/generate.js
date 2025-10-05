/**
 * Vercel Serverless Function (Node.js) のエントリーポイント
 * * この関数は、らくちん AI レシピ (index.html) からの POST リクエストを受け取り、
 * Google Gemini APIを呼び出して献立の提案をJSON形式で返します。
 * * Vercelの環境変数に GEMINI_API_KEY を設定する必要があります。
 */

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
                description: "献立のメインの料理名（例: 鶏むね肉と野菜の和風炒め）" 
            },
            "dishDescription": {
                type: "STRING",
                description: "料理の魅力や特徴を説明する簡潔で魅力的な一文。"
            },
            "requiredIngredients": {
                type: "STRING",
                description: "レシピに必要な、ユーザー入力に含まれていなかった主な追加食材や調味料（例: 醤油, 生姜, 油）をリスト形式ではなく一文でまとめる。"
            },
            "recipe": { 
                type: "STRING",
                description: "5ステップ程度の簡潔な調理手順を必ず番号付きリスト（例: 1. ..., 2. ...）で、必ず１手順ずつ改行入れて箇条書き、目安調理時間も表示、のMarkdown形式で記述。"
            },
        },
        required: ["level", "dishName", "dishDescription", "requiredIngredients", "recipe"],
        propertyOrdering: ["level", "dishName", "dishDescription", "requiredIngredients", "recipe"]
    },
    // 必ず3つの献立を返すように指示
    minItems: 3,
    maxItems: 3 
};

/**
 * ユーザーの入力に基づいて、Gemini APIへのプロンプトとシステム指示を構築する
 */
function buildPrompt(ingredients, mode, allergens) {
    let basePrompt = `冷蔵庫にある食材「${ingredients}」を使って、栄養バランスと調理のしやすさを考慮した3つの献立を提案してください。`;
    let systemInstruction = "あなたはプロの献立プランナーであり、大規模言語モデルを活用したレシピ生成AIです。ユーザーの要望に完璧に応える3つの献立を、以下のJSONスキーマに従って日本語で提案してください。調理手順は必ずMarkdownの番号付きリスト（1., 2., ...）を使用してください。";

    // モードに基づく調整
    switch (mode) {
        case 'healthy':
            basePrompt += "特に、**脂質やカロリーを抑えたヘルシーな献立**に重点を置いてください。";
            systemInstruction += "【制約】ヘルシーな調理法（蒸す、茹でる、ノンオイルなど）を推奨し、高カロリーな食材や調味料は極力避けてください。";
            break;
        case 'allergy':
            if (allergens) {
                basePrompt += `**アレルゲン（${allergens}）を完全に除去**した献立にしてください。`;
                systemInstruction += `【制約】ユーザーが指定したアレルゲン（${allergens}）をレシピから完全に排除してください。アレルゲンの代替食材を提案する場合は明記してください。`;
            } else {
                // フロントエンドでバリデーションされているはずだが、念のため
                basePrompt += "アレルゲン除去モードが選択されましたが、除去食材が指定されていません。一般的な献立を提案します。";
            }
            break;
        case 'normal':
        default:
            // 通常モード
            systemInstruction += "【制約】一般的な家庭で作りやすい、バラエティに富んだ献立を提案してください。";
            break;
    }
    
    // 献立レベルのガイドラインを追記
    systemInstruction += `提案する3つの献立の「level」は、それぞれ以下の3つのレベルに振り分けてください: 1.「究極のズボラ飯」（お金をかけずに超簡単・5分以内目標）, 2.「手軽・時短献立」（お手軽で時短で簡単・10〜20分目標）, 3.「ちょっとひと手間献立」（調理または少し手間がかかる献立・20～30分目標）。`;
    systemInstruction += `【重要】全ての献立を提案するにあたり、現在の物価高に加え、国民の手取り額も上がらない状況を考慮し、できるだけ安価な食材・調味料を使って現実的なものにすること。`;
    systemInstruction += `「下処理済みの〇〇」は店で買えるものであれば使用してよい。自前で準備する必要があるものはその手順と処理時間を考慮に入れること。`;
    systemInstruction += `食材を切る時間も考慮にいれること。`;
    systemInstruction += `子どもも喜ぶような献立を優先的に提案すること。`;
    
    return { basePrompt, systemInstruction };
}

/**
 * Vercel Serverless Functionのエクスポート関数
 */
module.exports = async (req, res) => {
    // APIキーがない場合はエラーを返す
    if (!GEMINI_API_KEY) {
        // 開発環境では警告、本番環境ではエラーとする
        if (process.env.NODE_ENV !== 'production') {
            console.warn("警告: GEMINI_API_KEYが設定されていません。ローカルテスト用には.envファイルを使用してください。");
        }
        res.status(500).json({ error: "Gemini APIキーが設定されていません。" });
        return;
    }
    
    // POSTメソッド以外は許可しない
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
        return;
    }

    try {
        const { ingredients, mode, allergens } = req.body;

        if (!ingredients || typeof ingredients !== 'string') {
            res.status(400).json({ error: "食材の入力が不正です。" });
            return;
        }

        const { basePrompt, systemInstruction } = buildPrompt(ingredients, mode, allergens);

        // Gemini APIへのリクエストペイロードを構築
        const payload = {
            contents: [{ parts: [{ text: basePrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            // 🚨 ここを generationConfig に修正
            generationConfig: { 
                // モデルに対してJSON形式での出力を指示
                responseMimeType: "application/json",
                responseSchema: responseSchema,
                temperature: 0.8, // 創造性を高める
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
            // ログに詳細なエラーを記録
            console.error(`Gemini API Error: ${errorText}`);
            throw new Error(`Gemini API呼び出し中にエラーが発生しました: ${apiResponse.status}。詳細はログを参照してください。`);
        }

        const apiResult = await apiResponse.json();
        
        const jsonText = apiResult.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!jsonText) {
             throw new Error("APIレスポンスからJSONテキストを抽出できませんでした。");
        }
        
        // JSON文字列をパース
        // JSON.parse()は構造化された応答が返された場合でも必要
        const menuData = JSON.parse(jsonText);
        
        // 成功レスポンスをフロントエンドに返す
        res.status(200).json({ menuData: menuData });

    } catch (error) {
        console.error("サーバーレス関数処理エラー:", error);
        res.status(500).json({ error: error.message || "予期せぬサーバーエラーが発生しました。" });
    }
};
