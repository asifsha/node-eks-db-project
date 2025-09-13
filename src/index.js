const express = require('express');


// list items
app.get('/items', async (req, res) => {
    try {
        const items = await listItems();
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// get
app.get('/items/:id', async (req, res) => {
    try {
        const item = await getItem(req.params.id);
        if (!item) return res.status(404).json({ error: 'not found' });
        res.json(item);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// post
app.post('/items', async (req, res) => {
    try {
        const id = uuidv4();
        const payload = Object.assign({}, req.body, { id, createdAt: new Date().toISOString() });
        await putItem(payload);
        res.status(201).json(payload);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// put (partial update)
app.put('/items/:id', async (req, res) => {
    try {
        const updated = await updateItem(req.params.id, req.body);
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// delete
app.delete('/items/:id', async (req, res) => {
    try {
        await deleteItem(req.params.id);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
});