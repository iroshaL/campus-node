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

        // qr gen
        const QRCode = require('qrcode');
    
        QRCode.toFile(`./qr/${user_id}.png`, toString(user_id), {
          errorCorrectionLevel: 'H'
        }, function(err) {
          if (err) throw err;
          console.log('QR code saved!');
          return res.json('success')
        });

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

const port = 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// login
app.post('/api/auth/login', (req,res) => {

    const sql = "SELECT * FROM users WHERE email = ?"

    pool.query(sql, [req.body.email], (err, data) => {
        
        if (err) {
            console.log(err)
            return res.json('Error')
        } 

        if (data.length > 0) {
            console.log(data)
            if (req.body.password == data[0].password) {
                console.log('logged in')
                return res.json("logged")
            }
        }
    });
});

// get rules for police
app.get('/api/rules', (req, res) => {

    const sql = "SELECT * FROM rules"

    pool.query(sql, (err, data) => {
        if(err) {
            console.log(err)
            return res.json('err')
        }

        if (data.length > 0) {
            console.log(data)
            return res.json(data)
        }
    })
})

// get driver details 
app.get('/api/getdriver', (req, res) => {

    const sql = "SELECT * FROM driver WHERE d_id = ?"

    pool.query(sql, [req.body.id], (err, data) => {
        if(err) {
            console.log(err)
            return res.json('err')
        }

        if (data.length > 0) {
            console.log(data)
            return res.json(data)
        }
    })
})

//issue fine
app.post('/api/issuefine', (req, res) => {

    const sql = "INSERT INTO issued_fines (d_id,r_id,p_id,fine_status) VALUES (?)"
    const values = [req.body.d_id, req.body.r_id, req.body.p_id, "pending"]

    pool.query(sql, [values], (err, data) => {
        if (err) {
            console.log(err)
            return res.json('err')
        } else {
            return res.json('success')
        }
    })
})

// get all fines
app.get('/api/getfine', (req, res) => {

    const sql = "SELECT * FROM issued_fines"

    pool.query(sql, (err, data) => {
        if(err) {
            console.log(err)
            return res.json('err')
        } else {
            console.log(data)
            return res.json(data)
        }
    })
})

//generate qr code
app.post('/api/qr', (req, res) => {
    const QRCode = require('qrcode');

    const id = req.body.id

    QRCode.toFile(`./qr/${id}.png`, toString(id), {
      errorCorrectionLevel: 'H'
    }, function(err) {
      if (err) throw err;
      console.log('QR code saved!');
      return res.json('success')
    });
})