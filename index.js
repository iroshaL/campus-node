const mysql = require('mysql');
const express = require('express');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const { createTransport } = require("nodemailer");

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

// Notification System
cron.schedule('0 0 * * *',() => {
    const currentDate = new Date();
    const midnight = new Date(currentDate);
    midnight.setHours(0,0,0,0);

    const elevenDaysAgo = new Date(midnight);
    elevenDaysAgo.setDate(elevenDaysAgo.getDate() + 11);

    const formattedDate = elevenDaysAgo.toISOString().split('T')[0];
    console.log(formattedDate);

    const sql = "SELECT * FROM issued_fines WHERE date < ? AND fine_status = 'pending'";
    const values = [formattedDate];

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log('Error  executing query: ', err);
            return;
        }

        result.forEach(fine => {
            const FineRuleName = "SELECT name FROM rules WHERE r_id=?";
            const FineRuleValues = [fine.r_id];

            pool.query(FineRuleName, FineRuleValues, (err, rule) => {
                if (err) {
                    console.log('Error  executing query: ', err);
                    return;
                }
                let message = rule[0].name;

                const NotificationSQL = "INSERT INTO notification (date_time, noti_data, d_id) VALUES (NOW(), ?, ?)";
                const NotificationValues = ['Fine is Overdue. You must pay quickly for '+message, fine.d_id];
    
                pool.query(NotificationSQL, NotificationValues, (err, result) => {
                    if (err) {
                        console.log('Error  executing query: ', err);
                        return;
                    }
    
                    console.log('Notification sent');
                });
            });
        });
    });
});


// Delete Notification According to Specific Driver
app.delete('/api/notification/delete/:id', (req, res) => {
    const sql = "DELETE FROM notification WHERE n_id = ?"
    const values = [req.params.id]

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json({message: 'Notification deleted successfully'});
    });
});


// Get Notification According to Driver ID
app.get('/api/notification/get/:id', (req, res) => {
    const sql = "SELECT * FROM notification WHERE d_id = ?"
    const values = [req.params.id]

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json(result);
    });
});


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

    const sql = "INSERT INTO issued_fines (d_id, r_id, p_id, fine_status, date) VALUES (?, ?, ?, ?, CURDATE())";
    const values = [req.body.d_id, req.body.r_id, req.body.p_id, "pending"];

    pool.query(sql, values, (err, data) => {
        if (err) {
            console.log(err)
            return res.json('err')
        } else {
            return res.json('success')
        }
    });
});

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

// //generate qr code
// app.post('/api/qr', (req, res) => {
//     const QRCode = require('qrcode');

//     const id = req.body.id

//     QRCode.toFile(`./qr/${id}.png`, toString(id), {
//       errorCorrectionLevel: 'H'
//     }, function(err) {
//       if (err) throw err;
//       console.log('QR code saved!');
//       return res.json('success')
//     });
// })


// password reset
app.post('/api/resetpassword', (req, res) => {
    
    const sql = "UPDATE users SET password = ? WHERE user_id = ?"

    pool.query(sql, [req.body.pass], [req.body.id], (err, data) => {
        if (err) {
            console.log(err)
            return res.json('error')
        } else {
            console.log('password changes')
            return res.json('success')
        }
    })
})

// otp
app.post('/api/otp', (req, res) => {

    const generateOTP = () => {
        return Math.floor(1000 + Math.random() * 9000); // Generates a random 4-digit OTP
      };
    
      const otp = generateOTP();
      console.log(otp);
    
      const userEmail = req.body.userEmail; // Assuming the email is sent in the request body
    
      const mailServer = createTransport({
        service: "gmail",
        auth: {
          user: "nskppoliceapp@gmail.com",
          pass: "cexp ixhu nlxd rlbp",
        },
      });
    
      console.log("Start sending email");
    
      mailServer.sendMail(
        {
          from: "NSKP POLICE APP <nskppoliceapp@gmail.com>",
          to: userEmail,
          subject: "OTP NSKP App",
          text: `Hello, Your OTP is: ${otp}`, // Use backticks for template string
        },
        async (err, info) => {
          if (err) {
            console.error("Can't send email:", err);
            res.status(500).json({ error: "Can't send email" }); // Send error response to the client
          } else {
            console.log("Email sent");
            try {
              // Save OTP to the user in the database
            //   const user = await User.findOneAndUpdate(
            //     { email: userEmail },
            //     { otp: otp }
            //   );

                const sql = `UPDATE users SET otp = ${otp} WHERE email = "${req.body.userEmail}"`

                pool.query(sql, (err, data) => {
                    if (err) {
                        console.log(err)
                        // return res.json('error')
                    } else {
                        console.log('password changes')
                        // return res.json('success')
                    }
                })

                // console.log("OTP saved to user:", user);
            } catch (error) {
              console.error("Error saving OTP to user:", error);
              res.status(500).json({ error: "Error saving OTP to user" }); // Send error response to the client
              return;
            }
            res.status(200).json({ message: "Email sent successfully" }); // Send success response to the client
          }
        }
      );
    
      console.log("Email sending process initiated");
})
