const mongoose = require('mongoose');

const gateRequestSchema = mongoose.Schema(
    {
        societyName: {
            type: String,
            required: true
        },
        residentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        residentFlatNumber: {
            type: String,
            required: true
        },
        visitorName: {
            type: String,
            required: true
        },
        purpose: {
            type: String,
            enum: ['guest', 'delivery'],
            required: true
        },
        fromWatchmanId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'expired'],
            default: 'pending',
            required: true
        },
        notes: String
    },
    {
        timestamps: true,
    }
)

exports.GateRequest = mongoose.model("gate_request", gateRequestSchema);


