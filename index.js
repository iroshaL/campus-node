const mysql = require('mysql');
const express = require('express');
const bodyParser = require('body-parser');

const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "1234",
    database: "test_fineapp"
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error('Error connecting to database:', err);
    } else {
        console.log('Connected to database successfully');
        connection.release(); // release the connection
    }
});

const app = express();
app.use(bodyParser.json());

app.post('/api/police', (req, res) => {
    const {national_id, id, name, address, phone_number, email, password, confirm_password} = req.body;

    if(!id || !name || !address || !phone_number || !email || !password || !confirm_password) {
        return res.status(400).send('Please enter all required fields');
    }

    if(password !== confirm_password) {
        return res.status(400).send('Password do not match');
    }

    const sql = 'INSERT INTO police (national_id, id, name, address, phone_number, email, password) VALUES (?, ?, ?, ?, ?, ?, ?)';
    const values = [national_id, id, name, address, phone_number, email, password];

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json({message: 'Police added successfully'});
    });
});

const port = 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});