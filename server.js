//import session from 'express-session';
const express = require('express');
const mongoose = require('mongoose');
//const session = require('express-session');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const nodemailer = require("nodemailer");

// Configure Brevo SMTP transporter
const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.BREVO_USER,
        pass: process.env.BREVO_PASS
    }
});

const _ = require('lodash');
const session = require('express-session');
const passport = require('passport');
const MongoStore = require('connect-mongo');
const user_collection = require("./models/userModel");
const society_collection = require("./models/societyModel");
const visit_collection = require("./models/visitModel");
const db = require(__dirname + '/config/db');
const date = require(__dirname + '/date/date');
const ContactRequest = require("./models/contactRequest");
const gate_request_collection = require("./models/gateRequestModel");


// Access environment variables

const stripe = require('stripe')(process.env.SECRET_KEY);
const app = express()
app.set('view engine', 'ejs');
app.use(express.static('public'));
// Middleware to handle HTTP post requests
app.use(express.urlencoded({ extended: true }));
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({
            mongoUrl: process.env.MONGO_URI,
            collectionName: "sessions",
        }),
        proxy: true,
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 24 * 60 * 60 * 1000,
        },
    })
);
app.use(passport.initialize());
app.use(passport.session());
db.connectDB()

app.post("/send-mail", async (req, res) => {
    try {
        const { Name, Email, Message } = req.body;

        await transporter.sendMail({
            from: `"E-Society Contact" <kbnisargpatel001454@gmail.com>`,
            to: process.env.TO_EMAIL,
            subject: `New Contact Form Message from ${Name}`,
            text: `
        Name: ${Name}
        Email: ${Email}
        Message: ${Message}
      `
        });

        res.send("✅ Email sent successfully!");
    } catch (err) {
        console.error("❌ Error sending email:", err);
        res.status(500).send("Failed to send email.");
    }
});


app.get("/", async (req, res) => {
    // Track page visits + users & societies registered
    try {
        let pageVisit = await visit_collection.Visit.findOne();
        if (!pageVisit) {
            pageVisit = new visit_collection.Visit({
                count: 0
            });
        }
        if (process.env.NODE_ENV === 'production') {
            pageVisit.count += 1;
        }
        await pageVisit.save();

        const societies = await society_collection.Society.find();
        const cities = societies.map(society => society.societyAddress.city.toLowerCase());
        const cityCount = new Set(cities).size;

        const foundUser = await user_collection.User.find();

        res.render("index", {
            city: cityCount,
            society: societies.length,
            user: foundUser.length,
            visit: pageVisit.count
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

app.get("/login", (req, res) => {
    res.render("login");
});

// Watchman auth views
app.get("/watchman/login", (req, res) => {
    res.render("watchmanLogin");
});

app.get("/watchman/signup", (req, res) => {
    society_collection.Society.find()
        .then(societies => {
            res.render("watchmanSignup", { societies });
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.get("/signup", (req, res) => {
    society_collection.Society.find()
        .then(societies => {
            res.render("signup", { societies });
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.get("/register", (req, res) => {
    res.render("register");
});

app.get("/home", (req, res) => {
    if (req.isAuthenticated()) {
        // Conditionally render home as per user validation status
        if (req.user.validation == 'approved') {
            res.render("home");
        } else if (req.user.validation == 'applied') {
            res.render("homeStandby", {
                icon: 'fa-user-clock',
                title: 'Account pending for approval',
                content: 'Your account will be active as soon as it is approved by your community.' +
                    'It usually takes 1-2 days for approval. If it is taking longer to get approval, ' +
                    'contact your society admin.'
            });
        } else {
            res.render("homeStandby", {
                icon: 'fa-user-lock',
                title: 'Account approval declined',
                content: 'Your account registration has been declined. ' +
                    'Please contact the society administrator for more details.' +
                    'You can edit the request and apply again.'
            });
        }
    } else {
        res.redirect("/login");
    }
});

app.get("/newRequest", (req, res) => {
    if (req.isAuthenticated() && req.user.validation != 'approved') {
        society_collection.Society.find()
            .then(societies => {
                res.render("signupEdit", { user: req.user, societies });
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/home");
    }
})

app.get("/logout", (req, res) => {
    req.logout(function () {
        res.redirect("/")
    });
})

app.get("/loginFailure", (req, res) => {
    const failureMessage = "Sorry, entered password was incorrect, Please double-check.";
    const hrefLink = "/login";
    const secondaryMessage = "Account not created?";
    const hrefSecondaryLink = "/signup";
    const secondaryButton = "Create Account";
    res.render("failure", {
        message: failureMessage,
        href: hrefLink,
        messageSecondary: secondaryMessage,
        hrefSecondary: hrefSecondaryLink,
        buttonSecondary: secondaryButton
    })
});

app.get("/residents", async (req, res) => {
    if (req.isAuthenticated() && req.user.validation == "approved") {
        try {
            const userSocietyName = req.user.societyName;

            const allSocietyUsers = await user_collection.User.find({
                societyName: userSocietyName,
            });

            const foundUsers = [];
            const foundAppliedUsers = [];

            for (let user of allSocietyUsers) {
                if (user.validation === "approved") {
                    const approvedRequest = await ContactRequest.findOne({
                        $or: [
                            { fromResident: req.user._id, toResident: user._id, status: "approved" },
                            { fromResident: user._id, toResident: req.user._id, status: "approved" },
                        ],
                    });

                    const pendingRequest = await ContactRequest.findOne({
                        $or: [
                            { fromResident: req.user._id, toResident: user._id, status: "pending" },
                            { fromResident: user._id, toResident: req.user._id, status: "pending" },
                        ],
                    });

                    foundUsers.push({
                        _id: user._id,
                        flatNumber: user.flatNumber,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        phoneNumber: approvedRequest ? user.phoneNumber : null,
                        requestStatus: approvedRequest ? "approved" : pendingRequest ? "pending" : null,
                        receivedRequest: pendingRequest && pendingRequest.toResident.equals(req.user._id),
                        requestId: pendingRequest ? pendingRequest._id : null
                    });
                } else if (user.validation === "applied") {
                    foundAppliedUsers.push(user);
                }
            }

            res.render("residents", {
                societyResidents: foundUsers,
                appliedResidents: foundAppliedUsers,
                societyName: userSocietyName,
                isAdmin: req.user.isAdmin,
            });
        } catch (err) {
            console.error(err);
            res.status(500).send("Server error");
        }
    } else {
        res.redirect("/login");
    }
});



app.get("/noticeboard", (req, res) => {
    if (req.isAuthenticated() && req.user.validation == 'approved') {
        society_collection.Society.findOne(
            { societyName: req.user.societyName },
            { noticeboard: 1 }
        )
            .then((foundSociety) => {
                if (foundSociety) {
                    // Check if no notice is present
                    if (
                        !foundSociety.noticeboard ||
                        !foundSociety.noticeboard.length
                    ) {
                        foundSociety.noticeboard = [
                            {
                                subject:
                                    "Access all important announcements, notices and circulars here.",
                            },
                        ];
                    }
                    res.render("noticeboard", {
                        notices: foundSociety.noticeboard,
                        isAdmin: req.user.isAdmin,
                    });
                }
            })
            .catch((err) => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/login");
    }
})

app.get("/notice", (req, res) => {
    if (req.isAuthenticated() && req.user.isAdmin) {
        res.render("notice");
    } else {
        res.redirect("/login");
    }
})

app.get("/bill", async (req, res) => {
    if (req.isAuthenticated() && req.user.validation == 'approved') {
        try {
            const foundUser = await user_collection.User.findById(req.user.id);
            const foundSociety = await society_collection.Society.findOne({ societyName: foundUser.societyName });

            const dateToday = new Date();
            // Payment required for total number of months
            let totalMonth = 0;
            // If lastPayment doesn't exist
            let dateFrom = foundUser.createdAt;
            // If lastPayment exists
            if (foundUser.lastPayment.date) {
                dateFrom = foundUser.lastPayment.date;
                totalMonth = date.monthDiff(dateFrom, dateToday);
            }
            else {
                // Add an extra month, as users joining date month payment's also pending
                totalMonth = date.monthDiff(dateFrom, dateToday) + 1;
            }

            // Calculate monthly bill of society maintenance
            const monthlyTotal = Object.values(foundSociety.maintenanceBill)
                .filter(ele => typeof (ele) == 'number')
                .reduce((sum, ele) => sum + ele, 0);

            let credit = 0;
            let due = 0;
            if (totalMonth == 0) {
                // Calculate credit balance
                credit = monthlyTotal;
            }
            else if (totalMonth > 1) {
                // Calculate pending due
                due = (totalMonth - 1) * monthlyTotal;
            }
            const totalAmount = monthlyTotal + due - credit;

            // Fetch validated society residents for admin features
            const foundUsers = await user_collection.User.find({
                $and: [
                    { "societyName": req.user.societyName },
                    { "validation": "approved" }
                ]
            });

            // Update amount to be paid on respective user collection
            foundUser.makePayment = totalAmount;
            await foundUser.save();

            res.render("bill", {
                resident: foundUser,
                society: foundSociety,
                totalAmount: totalAmount,
                pendingDue: due,
                creditBalance: credit,
                monthName: date.month,
                date: date.today,
                year: date.year,
                receipt: foundUser.lastPayment,
                societyResidents: foundUsers,
                monthlyTotal: monthlyTotal
            });
        } catch (err) {
            console.error(err);
            res.status(500).send("Server error");
        }
    } else {
        res.redirect("/login");
    }
})

app.get("/editBill", (req, res) => {
    if (req.isAuthenticated() && req.user.isAdmin) {
        society_collection.Society.findOne(
            { societyName: req.user.societyName },
            { maintenanceBill: 1 }
        )
            .then(foundSociety => {
                if (foundSociety) {
                    res.render("editBill", { maintenanceBill: foundSociety.maintenanceBill });
                }
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/login");
    }
})

app.get("/helpdesk", (req, res) => {
    if (req.isAuthenticated() && req.user.validation == 'approved') {
        // Conditionally render user/admin helpdesk
        if (req.user.isAdmin) {
            user_collection.User.find({
                $and: [
                    { "societyName": req.user.societyName },
                    { "validation": "approved" }
                ]
            })
                .then(foundUsers => {
                    res.render("helpdeskAdmin", { users: foundUsers });
                })
                .catch(err => {
                    console.error(err);
                    res.status(500).send("Server error");
                });
        } else {
            // Check if no complaint is present
            if (!req.user.complaints.length) {
                req.user.complaints = [{
                    'category': 'You have not raised any complaint',
                    'description': 'You can raise complaints and track their resolution by facility manager.'
                }];
            }
            res.render("helpdesk", { complaints: req.user.complaints });
        }
    } else {
        res.redirect("/login");
    }
})

// Watchman dashboard: create gate requests and see recent
app.get("/gate", async (req, res) => {
    if (req.isAuthenticated() && req.user.validation == 'approved' && req.user.isWatchman) {
        try {
            const recentRequests = await gate_request_collection.GateRequest.find({
                societyName: req.user.societyName
            }).sort({ createdAt: -1 }).limit(50);
            res.render("watchman", { requests: recentRequests });
        } catch (err) {
            console.error(err);
            res.status(500).send("Server error");
        }
    } else {
        res.redirect("/login");
    }
})

// Watchman creates a new gate request for resident approval
app.post("/gate/request", async (req, res) => {
    try {
        if (!(req.isAuthenticated() && req.user.validation == 'approved' && req.user.isWatchman)) {
            return res.redirect("/login");
        }

        const { flatNumber, visitorName, purpose, notes } = req.body;
        const resident = await user_collection.User.findOne({
            societyName: req.user.societyName,
            flatNumber: flatNumber,
            validation: 'approved'
        });
        if (!resident) {
            return res.status(404).send("Resident not found for this flat number");
        }

        const requestDoc = new gate_request_collection.GateRequest({
            societyName: req.user.societyName,
            residentId: resident._id,
            residentFlatNumber: resident.flatNumber,
            visitorName,
            purpose,
            fromWatchmanId: req.user._id,
            status: 'pending',
            notes
        });
        await requestDoc.save();

        // Notify resident via email (best-effort)
        try {
            await transporter.sendMail({
                from: `"Society Gate" <notifications@esociety.app>`,
                to: resident.username,
                subject: `Gate Approval Needed - Flat ${resident.flatNumber}`,
                text: `Visitor: ${visitorName}\nPurpose: ${purpose}\nPlease open app -> Gate Inbox to approve.`
            });
        } catch (mailErr) {
            console.warn("Email notify failed:", mailErr.message);
        }

        res.redirect("/gate");
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
})

// Resident inbox: view and respond to gate requests
app.get("/gate/inbox", async (req, res) => {
    if (req.isAuthenticated() && req.user.validation == 'approved' && !req.user.isWatchman) {
        try {
            const pending = await gate_request_collection.GateRequest.find({
                residentId: req.user._id,
                status: 'pending'
            }).sort({ createdAt: -1 });
            const history = await gate_request_collection.GateRequest.find({
                residentId: req.user._id,
                status: { $ne: 'pending' }
            }).sort({ updatedAt: -1 }).limit(50);
            res.render("gateInbox", { pending, history });
        } catch (err) {
            console.error(err);
            res.status(500).send("Server error");
        }
    } else {
        res.redirect("/login");
    }
})

app.post("/gate/approve", async (req, res) => {
    try {
        if (!(req.isAuthenticated() && req.user.validation == 'approved' && !req.user.isWatchman)) {
            return res.redirect("/login");
        }
        const { requestId } = req.body;
        const doc = await gate_request_collection.GateRequest.findOne({ _id: requestId, residentId: req.user._id });
        if (!doc) {
            return res.status(404).send("Request not found");
        }
        doc.status = 'approved';
        await doc.save();
        res.redirect("/gate/inbox");
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
})

app.post("/gate/reject", async (req, res) => {
    try {
        if (!(req.isAuthenticated() && req.user.validation == 'approved' && !req.user.isWatchman)) {
            return res.redirect("/login");
        }
        const { requestId } = req.body;
        const doc = await gate_request_collection.GateRequest.findOne({ _id: requestId, residentId: req.user._id });
        if (!doc) {
            return res.status(404).send("Request not found");
        }
        doc.status = 'rejected';
        await doc.save();
        res.redirect("/gate/inbox");
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
})

app.get("/complaint", (req, res) => {
    if (req.isAuthenticated() && req.user.validation == 'approved') {
        res.render("complaint");
    } else {
        res.redirect("/login");
    }
})

app.get("/contacts", (req, res) => {
    if (req.isAuthenticated() && req.user.validation == 'approved') {
        const userSocietyName = req.user.societyName;
        society_collection.Society.findOne(
            { "societyName": userSocietyName },
            { emergencyContacts: 1 }
        )
            .then(foundSociety => {
                if (foundSociety) {
                    res.render("contacts", { contact: foundSociety.emergencyContacts, isAdmin: req.user.isAdmin });
                }
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/login");
    }
})

app.get("/editContacts", (req, res) => {
    if (req.isAuthenticated() && req.user.isAdmin) {
        society_collection.Society.findOne(
            { societyName: req.user.societyName },
            { emergencyContacts: 1 }
        )
            .then(foundSociety => {
                if (foundSociety) {
                    res.render("editContacts", { contact: foundSociety.emergencyContacts });
                }
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/login");
    }
})

app.get("/profile", (req, res) => {
    if (req.isAuthenticated() && req.user.validation == 'approved') {
        user_collection.User.findById(req.user.id)
            .then(foundUser => {
                if (foundUser) {
                    return society_collection.Society.findOne({ societyName: foundUser.societyName })
                        .then(foundSociety => {
                            res.render("profile", { resident: foundUser, society: foundSociety });
                        });
                }
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/login");
    }
})

app.get("/editProfile", (req, res) => {
    if (req.isAuthenticated() && req.user.validation == 'approved') {
        user_collection.User.findById(req.user.id)
            .then(foundUser => {
                if (foundUser) {
                    return society_collection.Society.findOne({ societyName: foundUser.societyName })
                        .then(foundSociety => {
                            res.render("editProfile", { resident: foundUser, society: foundSociety });
                        });
                }
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/login");
    }
})

app.get('/success', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.query.session_id, {
            expand: ["payment_intent"],
        });

        // Payment details
        const amountPaid = session.amount_total / 100;
        const paymentDate = new Date().toLocaleDateString();

        // Save to DB if user exists
        if (req.user) {
            const foundUser = await user_collection.User.findById(req.user.id);

            foundUser.lastPayment.date = new Date();
            foundUser.lastPayment.amount = amountPaid;
            foundUser.lastPayment.invoice = session.id;

            await foundUser.save();
        }

        // Render success.ejs with data
        res.render("success", {
            invoice: session.id,
            amount: amountPaid,
            date: paymentDate,
        });

    } catch (err) {
        console.error("Stripe /success error:", err);
        res.status(500).send("Something went wrong on the success page.");
    }
});

app.post('/checkout-session', async (req, res) => {
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'inr',
                    product_data: {
                        name: req.user.societyName,
                        images: ['https://www.flaticon.com/svg/vstatic/svg/3800/3800518.svg?token=exp=1615226542~hmac=7b5bcc7eceab928716515ebf044f16cd'],
                    },
                    unit_amount: req.user.makePayment * 100,
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        success_url: "http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "http://localhost:3000/bill",
        //   success_url: "https://esociety-fdbd.onrender.com/success?session_id={CHECKOUT_SESSION_ID}",
        //   cancel_url: "https://esociety-fdbd.onrender.com/bill",
    });

    res.json({ id: session.id });
});

app.post("/approveResident", (req, res) => {
    const user_id = Object.keys(req.body.validate)[0]
    const validate_state = Object.values(req.body.validate)[0]
    user_collection.User.updateOne(
        { _id: user_id },
        {
            $set: {
                validation: validate_state
            }
        }
    ).then(() => res.redirect("/residents"))
})

app.post("/complaint", (req, res) => {
    user_collection.User.findById(req.user.id)
        .then(foundUser => {
            if (foundUser) {
                const complaint = {
                    'date': date.dateString,
                    'category': req.body.category,
                    'type': req.body.type,
                    'description': req.body.description,
                    'status': 'open'
                };
                foundUser.complaints.push(complaint);
                return foundUser.save()
                    .then(() => {
                        res.redirect("/helpdesk");
                    });
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
})

app.post("/closeTicket", (req, res) => {
    const user_id = Object.keys(req.body.ticket)[0];
    const ticket_index = Object.values(req.body.ticket)[0];
    const ticket = 'complaints.' + ticket_index;

    // Find user for fetching ticket data
    user_collection.User.findById(user_id)
        .then(foundUser => {
            if (foundUser) {
                return user_collection.User.updateOne(
                    { _id: user_id },
                    {
                        $set: {
                            [ticket]: {
                                status: 'close',
                                'date': foundUser.complaints[ticket_index].date,
                                'category': foundUser.complaints[ticket_index].category,
                                'type': foundUser.complaints[ticket_index].type,
                                'description': foundUser.complaints[ticket_index].description
                            }
                        }
                    }
                )
                    .then(() => {
                        res.redirect("/helpdesk");
                    });
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/notice", (req, res) => {
    society_collection.Society.findOne({ societyName: req.user.societyName })
        .then(foundSociety => {
            if (foundSociety) {
                const notice = {
                    'date': date.dateString,
                    'subject': req.body.subject,
                    'details': req.body.details
                };
                foundSociety.noticeboard.push(notice);
                return foundSociety.save()
                    .then(() => {
                        res.redirect("/noticeboard");
                    });
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/editBill", (req, res) => {
    society_collection.Society.updateOne(
        { societyName: req.user.societyName },
        {
            $set: {
                maintenanceBill: {
                    societyCharges: req.body.societyCharges,
                    repairsAndMaintenance: req.body.repairsAndMaintenance,
                    sinkingFund: req.body.sinkingFund,
                    waterCharges: req.body.waterCharges,
                    insuranceCharges: req.body.insuranceCharges,
                    parkingCharges: req.body.parkingCharges
                }
            }
        }
    )
        .then(() => {
            res.redirect("/bill");
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/editContacts", (req, res) => {
    society_collection.Society.updateOne(
        { societyName: req.user.societyName },
        {
            $set: {
                emergencyContacts: {
                    plumbingService: req.body.plumbingService,
                    medicineShop: req.body.medicineShop,
                    ambulance: req.body.ambulance,
                    doctor: req.body.doctor,
                    fireStation: req.body.fireStation,
                    guard: req.body.guard,
                    policeStation: req.body.policeStation
                }
            }
        }
    )
        .then(() => {
            res.redirect("/contacts");
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/editProfile", (req, res) => {
    user_collection.User.updateOne(
        { _id: req.user.id },
        {
            $set: {
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                phoneNumber: req.body.phoneNumber,
                flatNumber: req.body.flatNumber
            }
        }
    )
        .then(() => {
            // Update society data if any ~admin
            if (req.body.address) {
                return society_collection.Society.updateOne(
                    { admin: req.user.username },
                    {
                        $set: {
                            societyAddress: {
                                address: req.body.address,
                                city: req.body.city,
                                district: req.body.district,
                                postalCode: req.body.postalCode
                            }
                        }
                    }
                )
                    .then(() => {
                        res.redirect("/profile");
                    });
            } else {
                res.redirect("/profile");
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/newRequest", (req, res) => {
    // Submit new signup only if society exists
    society_collection.Society.findOne({ societyName: req.body.societyName })
        .then(foundSociety => {
            if (foundSociety) {
                return user_collection.User.updateOne(
                    { _id: req.user.id },
                    {
                        $set: {
                            firstName: req.body.firstName,
                            lastName: req.body.lastName,
                            phoneNumber: req.body.phoneNumber,
                            societyName: req.body.societyName,
                            flatNumber: req.body.flatNumber,
                            validation: 'applied'
                        }
                    }
                )
                    .then(() => {
                        res.redirect("/home");
                    });
            } else {
                const failureMessage = "Sorry, society is not registered, Please double-check society name.";
                const hrefLink = "/newRequest";
                const secondaryMessage = "Account not created?";
                const hrefSecondaryLink = "/signup";
                const secondaryButton = "Create Account";
                res.render("failure", {
                    message: failureMessage,
                    href: hrefLink,
                    messageSecondary: secondaryMessage,
                    hrefSecondary: hrefSecondaryLink,
                    buttonSecondary: secondaryButton
                });
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/signup", async (req, res) => {
    try {
        // Signup only if society is created
        const foundSociety = await society_collection.Society.findOne({ societyName: req.body.societyName });

        if (foundSociety) {
            const user = await user_collection.User.register(
                {
                    username: req.body.username,
                    societyName: req.body.societyName,
                    flatNumber: req.body.flatNumber,
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    phoneNumber: req.body.phoneNumber
                },
                req.body.password
            );

            await new Promise((resolve, reject) => {
                req.login(user, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });

            res.redirect("/home");
        } else {
            const failureMessage = "Sorry, society is not registered, Please double-check society name.";
            const hrefLink = "/signup";
            const secondaryMessage = "Society not registered?";
            const hrefSecondaryLink = "/register";
            const secondaryButton = "Register Society";
            res.render("failure", {
                message: failureMessage,
                href: hrefLink,
                messageSecondary: secondaryMessage,
                hrefSecondary: hrefSecondaryLink,
                buttonSecondary: secondaryButton
            });
        }
    } catch (err) {
        console.error(err);
        const failureMessage = "Sorry, this email address is not available. Please choose a different address.";
        const hrefLink = "/signup";
        const secondaryMessage = "Society not registered?";
        const hrefSecondaryLink = "/register";
        const secondaryButton = "Register Society";
        res.render("failure", {
            message: failureMessage,
            href: hrefLink,
            messageSecondary: secondaryMessage,
            hrefSecondary: hrefSecondaryLink,
            buttonSecondary: secondaryButton
        });
    }
});

// Watchman Signup (role = watchman, auto-approved)
app.post("/watchman/signup", async (req, res) => {
    try {
        const foundSociety = await society_collection.Society.findOne({ societyName: req.body.societyName });
        if (foundSociety) {
            const user = await user_collection.User.register(
                {
                    username: req.body.username,
                    societyName: req.body.societyName,
                    flatNumber: req.body.flatNumber || 'GATE',
                    firstName: req.body.firstName || 'Watchman',
                    lastName: req.body.lastName || '',
                    phoneNumber: req.body.phoneNumber,
                    isWatchman: true,
                    validation: 'approved'
                },
                req.body.password
            );
            await new Promise((resolve, reject) => {
                req.login(user, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            res.redirect("/gate");
        } else {
            const failureMessage = "Sorry, society is not registered, Please double-check society name.";
            res.render("failure", {
                message: failureMessage,
                href: "/watchman/signup",
                messageSecondary: "Society not registered?",
                hrefSecondary: "/register",
                buttonSecondary: "Register Society"
            });
        }
    } catch (err) {
        console.error(err);
        const failureMessage = "Sorry, this email address is not available. Please choose a different address.";
        res.render("failure", {
            message: failureMessage,
            href: "/watchman/signup",
            messageSecondary: "Society not registered?",
            hrefSecondary: "/register",
            buttonSecondary: "Register Society"
        });
    }
});

app.post("/register", async (req, res) => {
    try {
        // Signup only if society not registered
        const existingSociety = await society_collection.Society.findOne({ societyName: req.body.societyName });

        if (!existingSociety) {
            const user = await user_collection.User.register(
                {
                    validation: 'approved',
                    isAdmin: true,
                    username: req.body.username,
                    societyName: req.body.societyName,
                    flatNumber: req.body.flatNumber,
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    phoneNumber: req.body.phoneNumber
                },
                req.body.password
            );

            await new Promise((resolve, reject) => {
                req.login(user, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });

            // Create new society in collection
            const society = new society_collection.Society({
                societyName: user.societyName,
                societyAddress: {
                    address: req.body.address,
                    city: req.body.city,
                    district: req.body.district,
                    postalCode: req.body.postalCode
                },
                admin: user.username
            });

            await society.save();
            res.redirect("/home");
        } else {
            const failureMessage = "Sorry, society is already registered, Please double-check society name.";
            const hrefLink = "/register";
            const secondaryMessage = "Account not created?";
            const hrefSecondaryLink = "/signup";
            const secondaryButton = "Create Account";
            res.render("failure", {
                message: failureMessage,
                href: hrefLink,
                messageSecondary: secondaryMessage,
                hrefSecondary: hrefSecondaryLink,
                buttonSecondary: secondaryButton
            });
        }
    } catch (err) {
        console.error(err);
        res.redirect("/register");
    }
});

app.post("/login", passport.authenticate("local", {
    successRedirect: "/home",
    failureRedirect: "/loginFailure"
}));

// Watchman login (redirect to /gate if role ok)
app.post("/watchman/login", passport.authenticate("local", {
    failureRedirect: "/loginFailure"
}), (req, res) => {
    if (req.user && req.user.isWatchman) {
        return res.redirect("/gate");
    }
    req.logout(function () {
        res.redirect("/loginFailure");
    });
});

// Send a contact request
app.post("/contact-request/:toResidentId", async (req, res) => {
    try {
        const toResidentId = req.params.toResidentId;

        // check if request already exists
        let existing = await ContactRequest.findOne({
            fromResident: req.user._id,
            toResident: toResidentId,
        });

        if (!existing) {
            const request = new ContactRequest({
                fromResident: req.user._id,
                toResident: toResidentId,
            });
            await request.save();
        }

        res.redirect("/residents");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error sending request");
    }
});

// Approve a contact request
app.post("/approve-request/:requestId", async (req, res) => {
    try {
        const action = req.body.action; // "approved" or "declined"
        await ContactRequest.findByIdAndUpdate(req.params.requestId, { status: action });
        res.redirect("/residents");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating request");
    }
});


app.get("/health", (req, res) => {
    res.status(200).send("Server is running");
});

// Function to find an available port
const net = require('net');

function findAvailablePort(startPort, callback) {
    const server = net.createServer();

    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            // Port is in use, try the next one
            findAvailablePort(startPort + 1, callback);
        } else {
            callback(err);
        }
    });

    server.once('listening', () => {
        server.close();
        callback(null, startPort);
    });

    server.listen(startPort);
}

// Start server on available port
const initialPort = process.env.PORT || 3000;
findAvailablePort(initialPort, (err, port) => {
    if (err) {
        console.error("Error finding available port:", err);
        process.exit(1);
    }

    app.listen(port, () => {
        console.log(`🚀 Server started on port ${port}`);
        if (port !== initialPort) {
            console.log(`⚠️  Port ${initialPort} was in use, using port ${port} instead`);
        }
    });
});