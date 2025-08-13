// noinspection JSUnusedGlobalSymbols
/* global Buffer */
/**
 * Netlify function handler
 * @param {import('@netlify/functions').HandlerEvent} event
 * @param {import('@netlify/functions').HandlerContext} _context
 * @returns {Promise<import('@netlify/functions').HandlerResponse>}
 */
export async function handler(event, _context) {
    // noinspection JSUnresolvedVariable
    console.log('Proxy called with event:', event.queryStringParameters);
    console.log('');


    const BASE_URL = "https://rockbottom.pulseidconnect.com/api";
    const API_KEY = "pulseRockBottomGolf";
    const COMPANY = "PersonalizeYourGear";

    // noinspection JSUnresolvedVariable
    const method = event.httpMethod;
    // noinspection JSUnresolvedVariable
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
        const contentType = (response.headers.get("Content-Type") || "").toLowerCase();

        // Basic response logging
        console.log(`[PulseID] ${method} ${url} -> ${response.status} ${response.statusText}`);
        console.log(`[PulseID] Content-Type: ${contentType || 'n/a'}`);

        // If upstream failed, log and forward the error body
        if (!response.ok) {
            let errorBody;
            try {
                if (contentType.includes("application/json")) {
                    errorBody = await response.json();
                    console.error("[PulseID] Error JSON:", errorBody);
                } else {
                    errorBody = await response.text();
                    console.error("[PulseID] Error Text:", errorBody);
                }
            } catch (parseErr) {
                console.error("[PulseID] Error parsing error body:", parseErr);
                errorBody = `Upstream error ${response.status}: unable to parse body`;
            }

            return {
                statusCode: response.status,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, apiKey, company",
                    "Content-Type": contentType || "text/plain",
                    "Cache-Control": "no-store"
                },
                body: typeof errorBody === "string" ? errorBody : JSON.stringify(errorBody)
            };
        }

        // Handle images (e.g., PNG, JPEG) as base64
        if (contentType.startsWith("image/")) {
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

        // If upstream is not JSON, pass through as text (covers text/plain, text/html, etc.)
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            return {
                statusCode: response.status,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, apiKey, company",
                    "Content-Type": contentType || "text/plain",
                    "Cache-Control": "no-store"
                },
                body: text
            };
        }

        // Default: JSON
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
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, apiKey, company",
                "Content-Type": "application/json",
                "Cache-Control": "no-store"
            },
            body: JSON.stringify({ error: error.message }),
        };
    }
}