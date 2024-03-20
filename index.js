const mysql = require('mysql');
const express = require('express');
const fs = require('fs-extra')
const bodyParser = require('body-parser');
const cron = require('node-cron');
const { createTransport } = require("nodemailer");
const staticFilesDirectory = './qr';
const axios = require('axios');

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
    const if_id = req.body;
    const sql = "UPDATE issued_fines SET fine_status = 'paid' WHERE if_id = ?";

    pool.query(sql, if_id, (err, result) => {
        if(err) {
            console.log(err);
            return res.status(500).json({message: 'Internal server error'});
        }
        return res.status(200).json({message: 'Payment updated successfully'});
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


// // Add Driver to System
// app.post('/api/driver', (req, res) => {
//     const {nic, id, name, address, phone_number, email, password, confirm_password} = req.body;

//     console.log(req.body);
//     if(!id || !name || !address || !phone_number || !email || !password || !confirm_password) {
//         return res.status(400).send('Please enter all required fields');
//     }

//     if(password !== confirm_password) {
//         return res.status(400).send('Password do not match');
//     }

//     const idCheckSQL = "SELECT * FROM driver WHERE d_id = ?";
//     pool.query(idCheckSQL, [id], (err, result) => {
//         if(err) {
//             console.log(err);
//             return res.status(500).json({message: 'Internal server error'});
//         }

//         if(result.length > 0) {
//             return res.status(400).send('ID already exists');
//         }

//         const emailCheckSQL = "SELECT * FROM users WHERE email = ?";
//         pool.query(emailCheckSQL, [email], (err, result) => {
//             if(err) {
//                 console.log(err);
//                 return res.status(500).json({message: 'Internal server error'});
//             }

//             if (result.length > 0) {
//                 return res.status(400).send('Email already exists');
//             }

//             const sql1 = 'INSERT INTO users (email, password, role) VALUES (?, ?, ?)';
//             const values1 = [email, password, 'driver'];
        
//             pool.query(sql1, values1, (err, result) => {
//                 if(err) {
//                     console.log(err);
//                     return res.status(500).json({message: 'Internal server error'});
//                 }
        
//                 const user_id = result.insertId;
        
//                 // qr gen
//                 const QRCode = require('qrcode');
            
//                 QRCode.toFile(`./qr/${user_id}.png`, toString(user_id), {
//                     errorCorrectionLevel: 'H'
//                 }, function(err) {
//                     if (err) {
//                         console.log(err);
//                         return res.status(500).json({message: 'Internal server error'});
//                     }
//                     console.log('QR code saved!');
        
//                     const sql = 'INSERT INTO driver (nic, d_id, name, address, phone, email, password, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
//                     const values = [nic, id, name, address, phone_number, email, password, user_id];
                
//                     pool.query(sql, values, (err, result) => {
//                         if(err) {
//                             console.log(err);
//                             return res.status(500).json({message: 'Internal server error'});
//                         }
//                         return res.status(200).json({message: 'Driver added successfully'});
//                     });
//                 });
//             });
//         });
//     });
// });


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
                        QRCode.toFile(`./qr/${id}.png`, toString(id), {
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
    const { policeId, ruleId, driverId, finePrice } = req.body;

    if(!policeId, !ruleId, !driverId, !finePrice) {
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
        return res.status(200).json({message: 'Fine issued successfully'});
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
});


// upload file
app.post('/api/upload' , async (req, res) => {

    var realfile = Buffer.from(req.body.image, "base64")
    fs.writeFileSync(req.body.name, realfile, "utf8")

})


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
    })
})


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