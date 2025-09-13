const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");


const region = process.env.AWS_REGION || "ap-southeast-2";
const client = new DynamoDBClient({ region });
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME || "ItemsTable";


async function getItem(id) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id } }));
    return res.Item;
}


async function listItems() {
    const res = await ddb.send(new ScanCommand({ TableName: TABLE }));
    return res.Items || [];
}


async function putItem(item) {
    if (!item.id) throw new Error("id is required");
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    return item;
}


async function updateItem(id, patch) {
    // simple partial update: set provided attributes
    const expr = [];
    const names = {};
    const values = {};
    let i = 0;
    for (const k of Object.keys(patch)) {
        i++;
        const nameKey = `#k${i}`;
        const valKey = `:v${i}`;
        names[nameKey] = k;
        values[valKey] = patch[k];
        expr.push(`${nameKey} = ${valKey}`);
    }
    const updateExpression = `SET ${expr.join(", ")}`;
    await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW"
    }));
    return getItem(id);
}


async function deleteItem(id) {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
    return { id };
}


module.exports = { getItem, putItem, deleteItem, listItems, updateItem }