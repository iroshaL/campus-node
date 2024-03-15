const mysql = require('mysql');
const express = require('express');
const bodyParser = require('body-parser');

const pool = mysql.createPool({
    host: "fine-management.c9w4gu4g2114.eu-north-1.rds.amazonaws.com",
    user: "fine_m_admin",
    password: "fineSYSmm123",
    database: "fine-management",
    port: "8081"
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

// Add Police to System
app.post('/api/police', (req, res) => {
    const {national_id, id, name, address, phone_number, email, password, confirm_password} = req.body;

    if(!id || !name || !address || !phone_number || !email || !password || !confirm_password) {
        return res.status(400).send('Please enter all required fields');
    }

    if(password !== confirm_password) {
        return res.status(400).send('Password do not match');
    }

    const sql1 = 'INSERT INTO users (email, password, role) VALUES (?, ?, ?)';
    const values1 = [email, password, 'police'];

    pool.query(sql1, values1, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }

        const user_id = result.insertId;

        const sql = 'INSERT INTO police (nic, p_id, name, address, phone, email, password, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        const values = [national_id, id, name, address, phone_number, email, password, user_id];
    
        pool.query(sql, values, (err, result) => {
            if(err) {
                console.log(err);
                return res.status(500).json({message: 'Internal server error'});
            }
            return res.status(200).json({message: 'Police added successfully'});
        });
    });
});


// Add Driver to System
app.post('/api/driver', (req, res) => {
    const {nic, id, name, address, phone_number, email, password, confirm_password} = req.body;

    if(!id || !name || !address || !phone_number || !email || !password || !confirm_password) {
        return res.status(400).send('Please enter all required fields');
    }

    if(password !== confirm_password) {
        return res.status(400).send('Password do not match');
    }

    const sql1 = 'INSERT INTO users (email, password, role) VALUES (?, ?, ?)';
    const values1 = [email, password, 'driver'];

    pool.query(sql1, values1, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }

        const user_id = result.insertId;

        const sql = 'INSERT INTO driver (nic, d_id, name, address, phone, email, password, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        const values = [nic, id, name, address, phone_number, email, password, user_id];
    
        pool.query(sql, values, (err, result) => {
            if(err) {
                console.log(err);
                return res.status(500).json({message: 'Internal server error'});
            }
            return res.status(200).json({message: 'Driver added successfully'});
        });
    });
});


// Get Specific Police by ID
app.get('/api/police/:id', (req, res) => {
    const sql = "SELECT * FROM police WHERE p_id = ?";
    const values = [req.params.id];

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json(result);
    });
});


// Get Specific Driver by ID
app.get('/apu/driver/:id', (req, res) => {
    const sql = "SELECT * FROM driver WHERE d_id = ?";
    const values = [req.params.id];

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json(result);
    });
});


// Get Issued Fines by Driver ID
app.get('/api/fines/:id', (req, res) => {
    const sql = 'SELECT * FROM issued_fines WHERE d_id = ?';
    pool.query(sql, [req.params.id], (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json(result);
    });
});


// Add Invoice - Under Development
app.post('/api/invoice/add', (req, res) => {
    const {p_id, r_id, date_time, if_id} = req.body;
    sql = "INSERT INTO invoice (p_id, r_id, date_time, if_id) VALUES (?, ?, ?, ?)";
    values = [p_id, r_id, date_time, if_id];

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json({message: 'Invoice added successfully', result});
    });
});


const port = 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// login
app.post('/api/auth/login', (req,res) => {

    const sql = "SELECT * FROM users WHERE email = ?"

    pool.query(sql, [req.body.email], (err, data) => {
        if (err) {
            console.log(err);
            return res.json('Error');
        } 
        if (data.length > 0) {
            console.log(data)
            if (req.body.password == data[0].password) {
                console.log('logged in');
                return res.json("logged");
            }
        }
    });
});