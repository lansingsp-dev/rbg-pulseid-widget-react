export async function handler(event, context) {
    console.log('Proxy called with event:', event.queryStringParameters);

    const BASE_URL = "https://rockbottom.pulseidconnect.com/api";
    const API_KEY = "pulseRockBottomGolf";
    const COMPANY = "PersonalizeYourGear";

    const method = event.httpMethod;
    const { endpoint, ...queryParams } = event.queryStringParameters || {};

    if (!endpoint) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Missing 'endpoint' parameter" }),
        };
    }

    const query = new URLSearchParams(queryParams).toString();
    const url = `${BASE_URL}${endpoint}?${query}`;

    const options = {
        method,
        headers: {
            "apiKey": API_KEY,
            "company": COMPANY,
            "Content-Type": "application/json",
        }
    };

    if (method === "POST" || method === "PUT") {
        options.body = event.body;
    }

    try {
        const response = await fetch(url, options);
        const contentType = response.headers.get("Content-Type");

        if (contentType && contentType.startsWith("image/")) {
            // Handle image (like PNG)
            const buffer = await response.arrayBuffer();
            return {
                statusCode: response.status,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, apiKey, company",
                    "Content-Type": contentType,
                    "Cache-Control": "no-store"
                },
                body: Buffer.from(buffer).toString("base64"),
                isBase64Encoded: true
            };
        }

        // Default: assume JSON
        const data = await response.json();
        return {
            statusCode: response.status,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, apiKey, company",
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
            },
            body: JSON.stringify(data),
        };
    } catch (error) {
        console.error('Error fetching from PulseID API:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
}