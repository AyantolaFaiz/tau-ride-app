const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- SYSTEM DATABASE (Memory) ---
let registeredUsers = []; 
let onlineDrivers = {};
let currentRide = null; 
let complaints = []; // New Complaints Database
let campusRoutes = {
    "East Campus": ["East Faculty", "East Cafeteria", "East Field", "Boys Hostel", "Girls Hostel", "East Gate"],
    "West Campus": ["Management Faculty", "Law Faculty", "West Cafeteria", "West Field", "West Gate"]
};

io.on('connection', (socket) => {
    
    const sendUpdate = () => {
        io.emit('systemUpdate', { routes: campusRoutes, ride: currentRide, drivers: Object.values(onlineDrivers), users: registeredUsers, complaints: complaints });
    };

    sendUpdate();

    // --- 1. AUTHENTICATION & APPROVAL ---
    socket.on('registerUser', (userData, callback) => {
        if (!userData.id.toLowerCase().endsWith('@tau.edu.ng')) return callback({ success: false, message: 'Only @tau.edu.ng emails allowed.' });
        if(registeredUsers.find(u => u.id === userData.id)) return callback({ success: false, message: 'Email already registered.' });

        // Drivers must be approved by Admin. Students are auto-approved.
        userData.approved = userData.role === 'driver' ? false : true; 

        registeredUsers.push(userData); 
        callback({ success: true, user: userData });
        sendUpdate();
    });

    socket.on('loginUser', (creds, callback) => {
        if(creds.role === 'admin') {
            if(creds.id === 'admin' && creds.password === 'admin123') return callback({ success: true, user: { name: 'Super Admin', id: 'admin', role: 'admin' } });
            return callback({ success: false, message: 'Invalid Admin Credentials.' });
        }
        if (!creds.id.toLowerCase().endsWith('@tau.edu.ng')) return callback({ success: false, message: 'Please use @tau.edu.ng email.' });

        const user = registeredUsers.find(u => u.id === creds.id && u.password === creds.password && u.role === creds.role);
        if(user) {
            // Block unapproved drivers
            if(user.role === 'driver' && !user.approved) return callback({ success: false, message: 'Your account is pending Admin approval.' });
            callback({ success: true, user: user });
        } else {
            callback({ success: false, message: 'Invalid credentials. Please Sign Up first.' });
        }
    });

    // --- 2. ADMIN ACCOUNT MANAGEMENT ---
    socket.on('approveDriver', (driverId) => {
        let d = registeredUsers.find(u => u.id === driverId);
        if(d) d.approved = true;
        sendUpdate();
    });

    socket.on('deleteDriver', (driverId) => {
        // Remove from DB
        registeredUsers = registeredUsers.filter(u => u.id !== driverId);
        // Kick offline if they are online
        let onlineKey = Object.keys(onlineDrivers).find(k => onlineDrivers[k].id === driverId);
        if(onlineKey) delete onlineDrivers[onlineKey];
        sendUpdate();
    });

    // --- 3. RIDES & COMPLAINTS ---
    socket.on('bookRide', (rideData) => {
        currentRide = { ...rideData, status: 'pending' };
        sendUpdate();
    });

    socket.on('acceptRide', () => {
        if (currentRide) currentRide.status = 'accepted';
        sendUpdate();
    });

    // Driver Declines Ride
    socket.on('declineRide', () => {
        currentRide = null;
        sendUpdate();
        io.emit('rideCancelled', 'The driver declined your request. Please choose another driver.');
    });

    // Admin Cancels Ride
    socket.on('adminCancelRide', () => {
        currentRide = null;
        sendUpdate();
        io.emit('rideCancelled', 'Your current ride was cancelled by the Administrator.');
    });

    socket.on('completeRide', () => {
        currentRide = null;
        sendUpdate();
    });

    // Submit Complaint
    socket.on('submitComplaint', (data) => {
        complaints.push(data);
        sendUpdate();
    });

    // --- 4. ROUTES & DRIVER STATUS ---
    socket.on('addRoute', (data) => {
        if(campusRoutes[data.campus]) campusRoutes[data.campus].push(data.newStop);
        sendUpdate();
    });

    socket.on('removeRoute', (data) => {
        if(campusRoutes[data.campus]) campusRoutes[data.campus] = campusRoutes[data.campus].filter(stop => stop !== data.stop);
        sendUpdate();
    });

    socket.on('driverOnline', (driverProfile) => {
        onlineDrivers[socket.id] = { ...driverProfile, socketId: socket.id };
        sendUpdate();
    });

    socket.on('disconnect', () => {
        if(onlineDrivers[socket.id]) delete onlineDrivers[socket.id];
        sendUpdate();
    });
});

server.listen(3000, () => console.log('✅ Master Server running on http://localhost:3000'));