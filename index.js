const mysql = require('mysql');
const express = require('express');
const fs = require('fs-extra')
const bodyParser = require('body-parser');
const cron = require('node-cron');
const { createTransport } = require("nodemailer");
const staticFilesDirectory = './qr';
const axios = require('axios');
const multer = require('multer');
const path = require('path');

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
app.use('/static', express.static(staticFilesDirectory));

app.use(express.json({ limit: '100mb' })); // Parse JSON bodies
app.use(express.urlencoded({ limit: '100mb', extended: true })); // Parse URL-encoded bodies

// Notification System
cron.schedule('0 0 * * *',() => {
    const currentDate = new Date();
    const midnight = new Date(currentDate);
    midnight.setHours(0,0,0,0);

    const elevenDaysAgo = new Date(midnight);
    elevenDaysAgo.setDate(elevenDaysAgo.getDate() - 11);

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


// Delayed Fines Double System
cron.schedule('0 0 * * *', () => {
    const currentDate = new Date();
    const midnight = new Date(currentDate);
    midnight.setHours(0,0,0,0);

    const fourteenDaysAgo = new Date(midnight);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const formattedDate = fourteenDaysAgo.toISOString().split('T')[0];
    console.log(formattedDate);

    const sql = "SELECT * FROM issued_fines WHERE date < ? AND fine_status = 'pending' AND payment_doubled = 'no'";
    const values = [formattedDate];

    pool.query(sql, values, (err, result) => {
        if (err) {
            console.log('Error  executing query: ', err);
            return;
        }

        console.log(result);
        result.forEach(issuedFine => {
            // Double Fine and Update Payment Doubled to 'yes'
            const doubleFine = issuedFine.price * 2;
            const updatedTable = "UPDATE issued_fines SET price = ?, payment_doubled = 'yes' WHERE if_id = ?";
            const updatedValues = [doubleFine, issuedFine.if_id];

            pool.query(updatedTable, updatedValues, (err, result) => {
                if (err) {
                    console.log('Error  executing query: ', err);
                    return;
                }

                console.log('Fine Doubled and Payment Doubled Updated')  
            });
        });
    });
});


// Get Driver Details by ID
app.get('/api/driver/:id', (req, res) => {
    console.log(req.params.id);
    const sql = "SELECT * FROM driver WHERE user_id = ?";
    const values = [req.params.id];

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log('Error  executing query: ', err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json(result);
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


// Update Payment in Issued Fines
app.put('/api/payment/update', (req, res) => {
    const if_id = req.body.if_id;
    console.log(if_id);
    
    // Start a transaction
    pool.getConnection((err, connection) => {
        if (err) {
            console.error('Error connecting to database:', err);
            return res.status(500).json({ message: 'Failed to connect to database' });
        }

        connection.beginTransaction(err => {
            if (err) {
                console.error('Error starting transaction:', err);
                connection.release();
                return res.status(500).json({ message: 'Failed to start transaction' });
            }

            // Update fine status
            const updateSql = "UPDATE issued_fines SET fine_status = 'paid' WHERE if_id = ?";
            connection.query(updateSql, [if_id], (err, updateResult) => {
                if (err) {
                    console.error('Error updating fine status:', err);
                    return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ message: 'Failed to update fine status' });
                    });
                }

                // Insert notification to Notify Police
                const notificationSql = "INSERT INTO notification (date_time, noti_data, d_id) VALUES (NOW(), ?, (SELECT d_id FROM issued_fines WHERE if_id = ?))";
                const notificationValues = ["Fine is Paid by Driver ID - " + if_id, if_id];

                connection.query(notificationSql, notificationValues, (err, notificationResult) => {
                    if (err) {
                        console.error('Error inserting notification:', err);
                        return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ message: 'Failed to insert notification' });
                        });
                    }

                    // Insert notification to Notify Driver
                    const notificationSql2 = "INSERT INTO notification (date_time, noti_data, d_id) VALUES (NOW(), ?, (SELECT d_id FROM issued_fines WHERE if_id = ?))";
                    const notificationValues2 = ["You have Successfully Paid the Fine for - " + if_id +" Fine.", if_id];

                    connection.query(notificationSql2,notificationValues2, (err, notificationResult2) => {
                        if (err) {
                            console.error('Error inserting notification:', err);
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ message: 'Failed to insert notification' });
                            });
                        }

                        // Commit the transaction if everything is successful
                        connection.commit(err => {
                            if (err) {
                                console.error('Error committing transaction:', err);
                                return connection.rollback(() => {
                                    connection.release();
                                    res.status(500).json({ message: 'Failed to commit transaction' });
                                });
                            }

                            console.log('Transaction committed successfully');
                            connection.release();
                            res.status(200).json({ message: 'Payment updated and notification sent successfully' });
                        });
                    });
                });
            });
        });
    });
});




// Get Data From Rule Table and Issued Fines Table by IF_ID
app.get("/api/fineDetails/:id", (req, res) => {
    const ifId = req.params.id;
    const sql = "SELECT * FROM issued_fines WHERE if_id = ?";
    const values = [ifId];

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        console.log(result);
        
        const ruleId = result[0].r_id;
        const ruleSQL = "SELECT * FROM rules WHERE r_id = ?";
        const ruleValues = [ruleId];

        pool.query(ruleSQL, ruleValues, (err, ruleResult) => {
            if(err) {
                console.log(err);
                return res.status(500).json({message: 'Internal server error'});
            }
            console.log(ruleResult);
            const finalResult = [result, ruleResult];
            return res.status(200).json(finalResult);
        });
    });
});


// Get All Pending Fines for Specific Driver
app.post('/api/pendingFines', (req, res) => {
    const sql = "SELECT * FROM issued_fines WHERE fine_status = 'pending' AND d_id = ?";
    const driverId = req.body.d_id;
    pool.query(sql, driverId, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json(result);
    });
});


// Get All Paid Fines for Specific Driver
app.post('/api/paidFines', (req, res) => {
    const sql = "SELECT * FROM issued_fines WHERE fine_status = 'paid' AND d_id = ?";
    const values = [req.body.d_id];
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
    const { national_id, id, name, address, phone_number, email, password, confirm_password } = req.body;

    if (!id || !name || !address || !phone_number || !email || !password || !confirm_password) {
        return res.status(400).send('Please enter all required fields');
    }

    if (password !== confirm_password) {
        return res.status(400).send('Password do not match');
    }

    // Get a connection from the pool
    pool.getConnection((err, connection) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ message: 'Failed to get connection from pool' });
        }

        // Start a transaction
        connection.beginTransaction((err) => {
            if (err) {
                console.log(err);
                connection.release(); // Release the connection
                return res.status(500).json({ message: 'Internal server error' });
            }

            const idCheckSQL = "SELECT * FROM police WHERE p_id = ?";
            connection.query(idCheckSQL, [id], (err, result) => {
                if (err) {
                    console.log(err);
                    rollbackAndRelease(connection, res, 'Internal server error');
                    return;
                }

                if (result.length > 0) {
                    rollbackAndRelease(connection, res, 'ID already exists');
                    return;
                }

                const emailCheckSQL = "SELECT * FROM users WHERE email = ?";
                connection.query(emailCheckSQL, [email], (err, result) => {
                    if (err) {
                        console.log(err);
                        rollbackAndRelease(connection, res, 'Internal server error');
                        return;
                    }

                    if (result.length > 0) {
                        rollbackAndRelease(connection, res, 'Email already exists');
                        return;
                    }

                    const sql1 = 'INSERT INTO users (email, password, role) VALUES (?, ?, ?)';
                    const values1 = [email, password, 'police'];

                    connection.query(sql1, values1, (err, result) => {
                        if (err) {
                            console.log(err);
                            rollbackAndRelease(connection, res, 'Internal server error');
                            return;
                        }

                        const user_id = result.insertId;

                        const sql = 'INSERT INTO police (nic, p_id, name, address, phone, email, password, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
                        const values = [national_id, id, name, address, phone_number, email, password, user_id];

                        connection.query(sql, values, (err, result) => {
                            if (err) {
                                console.log(err);
                                rollbackAndRelease(connection, res, 'Internal server error');
                                return;
                            }

                            // Commit the transaction if all queries succeed
                            connection.commit((err) => {
                                if (err) {
                                    console.log(err);
                                    rollbackAndRelease(connection, res, 'Internal server error');
                                    return;
                                }

                                // Release the connection
                                connection.release();
                                return res.status(200).json({ message: 'Police added successfully' });
                            });
                        });
                    });
                });
            });
        });
    });
});


// Add Driver to System
app.post('/api/driver', (req, res) => {
    const { nic, id, name, address, phone_number, email, password, confirm_password } = req.body;

    if (!id || !name || !address || !phone_number || !email || !password || !confirm_password) {
        return res.status(400).send('Please enter all required fields');
    }

    if (password !== confirm_password) {
        return res.status(400).send('Password do not match');
    }

    pool.getConnection((err, connection) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ message: 'Internal server error' });
        }

        connection.beginTransaction((err) => {
            if (err) {
                console.log(err);
                connection.release();
                return res.status(500).json({ message: 'Internal server error' });
            }

            const idCheckSQL = "SELECT * FROM driver WHERE d_id = ?";
            connection.query(idCheckSQL, [id], (err, result) => {
                if (err) {
                    console.log(err);
                    return rollbackAndRelease(connection, res, 'Internal server error');
                }

                if (result.length > 0) {
                    return rollbackAndRelease(connection, res, 'ID already exists');
                }

                const emailCheckSQL = "SELECT * FROM users WHERE email = ?";
                connection.query(emailCheckSQL, [email], (err, result) => {
                    if (err) {
                        console.log(err);
                        return rollbackAndRelease(connection, res, 'Internal server error');
                    }

                    if (result.length > 0) {
                        return rollbackAndRelease(connection, res, 'Email already exists');
                    }

                    const sql1 = 'INSERT INTO users (email, password, role) VALUES (?, ?, ?)';
                    const values1 = [email, password, 'driver'];

                    connection.query(sql1, values1, (err, result) => {
                        if (err) {
                            console.log(err);
                            return rollbackAndRelease(connection, res, 'Internal server error');
                        }

                        const user_id = result.insertId;

                        const QRCode = require('qrcode');
                        QRCode.toFile(`./qr/${id}.png`, JSON.stringify({ driver_id: id }), {
                            errorCorrectionLevel: 'H'
                        }, function (err) {
                            if (err) {
                                console.log(err);
                                return rollbackAndRelease(connection, res, 'Internal server error');
                            }

                            console.log('QR code saved!');

                            const sql = 'INSERT INTO driver (nic, d_id, name, address, phone, email, password, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
                            const values = [nic, id, name, address, phone_number, email, password, user_id];

                            connection.query(sql, values, (err, result) => {
                                if (err) {
                                    console.log(err);
                                    return rollbackAndRelease(connection, res, 'Internal server error');
                                }

                                connection.commit((err) => {
                                    if (err) {
                                        console.log(err);
                                        return rollbackAndRelease(connection, res, 'Internal server error');
                                    }

                                    connection.release();
                                    return res.status(200).json({ message: 'Driver added successfully' });
                                });
                            });
                        });
                    });
                });
            });
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


// Get Driver ID by User ID
app.get('/api/driver/user/:id', (req, res) => {
    const sql = "SELECT d_id FROM driver WHERE user_id = ?";
    const values = [req.params.id];

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json(result);
    });
});

// Get Police ID by User ID
app.get('/api/police/user/:id', (req, res) => {
    const sql = "SELECT p_id FROM police WHERE user_id = ?";
    const values = [req.params.id];

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json(result);
    });
});


// Issue Fine
app.post('/api/issueFine', (req, res) => {
    // const { policeId, ruleId, driverId, finePrice } = req.body;
    console.log(req.body);
    const policeId = parseInt(req.body.policeId);
    const ruleId = parseInt(req.body.ruleId);
    const driverId = parseInt(req.body.driverId);
    const finePrice = req.body.finePrice;

    if(!policeId || !ruleId || !driverId || !finePrice) {
        return res.status(400).json({message: 'Please enter all required fields'});
    }

    const sql = "INSERT INTO issued_fines (d_id, r_id, p_id, price, fine_status, date, payment_doubled) VALUES (?,?,?,?,?,?,?)";
    const currentDate = new Date().toISOString().split('T')[0];
    const values = [driverId, ruleId, policeId, finePrice, 'pending', currentDate, 'no'];

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        console.log('Fine issued successfully');
        return res.status(200).json({message: 'Fine issued successfully'});
    });
});


// Get Police by User ID
app.get('/api/police/user/:id', (req, res) => {
    const sql = "SELECT * FROM police WHERE user_id = ?";
    const values = [req.params.id];

    pool.query(sql, values, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json(result);
    });
});


// login
app.post('/api/auth/login', (req, res) => {
    const sql = "SELECT * FROM users WHERE email = ?";
    pool.query(sql, [req.body.email], (err, data) => {
        if (err) {
            console.log(err);
            return res.status(500).json({ message: 'Internal server error' });
        } 

        if (data.length > 0) {
            if (req.body.password === data[0].password) {
                console.log('logged in');
                console.log(data);
                console.log(data[0].user_id);

                const user_data = data[0];
                const user_id = data[0].user_id;
                const sql = "SELECT * FROM driver WHERE user_id = ?";
                const values = [user_id];

                pool.query(sql, values, (err, data) => {
                    if (err) {
                        console.log(err);
                        return res.status(500).json({ message: 'Internal server error' });
                    } else {
                        console.log(data);
                        const allData = [user_data, data[0]];
                        return res.json(allData);
                    }
                })
            } else {
                return res.status(401).json({ message: 'Unauthorized' });
            }
        } else {
            return res.status(401).json({ message: 'Unauthorized' });
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
app.get('/api/getdriver/:id', (req, res) => {

    const sql = "SELECT * FROM driver WHERE d_id = ?"

    pool.query(sql, [req.params.id], (err, data) => {
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
// app.post('/api/issuefine', (req, res) => {

//     const sql = "INSERT INTO issued_fines (d_id, r_id, p_id, fine_status, date) VALUES (?, ?, ?, ?, CURDATE())";
//     const values = [req.body.d_id, req.body.r_id, req.body.p_id, "pending"];

//     pool.query(sql, values, (err, data) => {
//         if (err) {
//             console.log(err)
//             return res.json('err')
//         } else {
//             return res.json('success')
//         }
//     });
// });

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

    const newPassword = req.body.pass;
    const email = req.body.email
    
    const sql = "UPDATE users SET password = ? WHERE email = ?";
    const values = [newPassword, email];

    pool.query(sql, values, (err, data) => {
        if (err) {
            console.log(err)
            return res.json('error')
        } else {
            console.log('Password changeD')
            return res.json('Success')
        }
    });
});


// verify otp
app.post('/api/verifyotp', (req, res) => {
    const otp = req.body.otp;
    console.log(req.body);
    console.log("OTP Code - " + otp);
    console.log("Email - " + req.body.email);
    const sql = "SELECT * FROM users WHERE email = ?";
    const values = [req.body.email];

    pool.query(sql, values, (err, data) => {
        if (err) {
            console.log("Database error:", err);
            return res.status(500).json({ message: 'Database error' });
        } else {
            console.log("User data:", data);
            if (data.length > 0 && parseInt(data[0].otp) === parseInt(otp)) {
                console.log('Correct OTP');
                return res.json('Correct OTP');
            } else {
                console.log('Wrong OTP or user not found');
                return res.json('Wrong OTP or user not found');
            }
        }
    });
});


// get user_id with email
app.get('/api/user/:email', (req, res) => {

    const sql = "SELECT * FROM users WHERE email = ?"

    pool.query(sql, [req.params.email], (err, data) => {
        if(err) {
            console.log(err)
            return res.json('err')
        } else {
            console.log(data)
            return res.json(data)
        }
    });
});


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
                        console.log(err);
                        // return res.json('error')
                    } else {
                        console.log('OTP Saved to user: ', data);
                        // return res.json('success')
                    }
                });

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
});


// upload file
app.post('/api/upload' , async (req, res) => {

    const { d_id, name } = req.body;

    var realfile = Buffer.from(req.body.image, "base64")
    fs.writeFileSync(req.body.name, realfile, "utf8")

    saveDocumentToDatabase(d_id, name);

    return res.status(200).json({ message: 'Document uploaded successfully' });
});


function saveDocumentToDatabase(d_id, doc_name) {
    // Assuming you're using a MySQL database
    const sql = 'INSERT INTO document (d_id, doc_name) VALUES (?, ?)';
    const values = [d_id, doc_name];

    // Execute the SQL query to insert document details
    pool.query(sql, values, (err, result) => {
        if (err) {
            console.log('Error saving document details to database:', err);
            // Handle error
        } else {
            console.log('Document details saved to database');
            // Document details successfully saved to database
        }
    });
}


// ==>> New Files Upload Section

// Set Storage Engine
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, path.join(__dirname, 'uploads')); // Save uploaded files to the 'uploads' directory
    },
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname); // Append a unique suffix to the original file name
    }
});


// Initialize multer upload
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 10MB limit
    }
});


// Upload file
app.post('/api/uploadFile', upload.single('image'), async(req, res) => {
    const d_id = req.body.d_id;
    const name = req.file.filename; // Get the filename generated by multer

    saveDocumentToDatabase(d_id, name, res); // Pass the 'res' object to the function
});

function saveDocumentToDatabase(d_id, doc_name, res) {
    const sql = 'INSERT INTO document (d_id, doc_name) VALUES (?, ?)';
    const values = [d_id, doc_name];

    pool.query(sql, values, (err, result) => {
        if (err) {
            console.log('Error saving document details to database:', err);
            return res.status(500).json({ message: 'Internal server error' }); // Send response here
        } else {
            console.log('Document details saved to database');
            return res.status(200).json({ message: 'Document details saved to database' }); // Send response here
        }
    });
}

// Invoice 
app.post('/api/invoice', (req, res) => {

    const sql = `INSERT INTO invoice (p_id, r_id, date_time, if_id) VALUES(${req.body.p_id}, ${req.body.r_id}, CURRENT_TIMESTAMP(), ${req.body.if_id})`

    pool.query(sql, (err, data) => {
        if(err) {
            console.log(err)
            return res.json("error")
        } else {
            console.log('invoice sent to database')
            return res.json('success')
        }
    });
});


// Payment Gateway Testing
app.post('/api/payment', async (req, res) => {
    const { cardNumber, cardHolder, expiryDate, cvv, amount } = req.body;

    if(!cardNumber || !cardHolder || !expiryDate || !cvv || !amount) {
        return res.status(400).json({message: 'Please enter all required fields'});
    }

    // cardNumber INT to String
    const cardNumberString = cardNumber.toString();
    const options = {
        method: 'POST',
        url: 'https://card-validator.p.rapidapi.com/validate',
        headers: {
          'content-type': 'application/json',
          'X-RapidAPI-Key': '50437e9590msh036761da096f726p157a97jsn31198ee488cf',
          'X-RapidAPI-Host': 'card-validator.p.rapidapi.com'
        },
        data: {cardNumber: cardNumberString}
      };

      try {
        const response = await axios.request(options);
        console.log(response.data);

        if (response.data.isValid) {
            return res.status(200).json({ message: 'Card is valid. Payment successful' });
        } else {
            return res.status(400).json({ message: 'Card is invalid. Payment failed' });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});


// Error Handling Function
function rollbackAndRelease(connection, res, message) {
    connection.rollback(() => {
        connection.release();
        return res.status(500).json({ message });
    });
}


const port = 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});