"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = exports.storage = exports.db = exports.isFirebaseEnabled = void 0;
var app_1 = require("firebase-admin/app");
var firestore_1 = require("firebase-admin/firestore");
var storage_1 = require("firebase-admin/storage");
var auth_1 = require("firebase-admin/auth");
var projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
var storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
var serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
var credential;
if (serviceAccountKey) {
    try {
        credential = (0, app_1.cert)(JSON.parse(serviceAccountKey));
    }
    catch (e) {
        console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY, falling back to default credentials:', e);
    }
}
// 1. Force Admin SDK to talk to the Emulator
if (process.env.STORAGE_EMULATOR_HOST) {
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.STORAGE_EMULATOR_HOST;
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIREBASE_FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
}
if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
}
// Enable Firebase if explicit keys exist, OR if running in production, OR if Project ID is present (ADC), OR if Emulators are active
exports.isFirebaseEnabled = !!(serviceAccountKey || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.NODE_ENV === 'production' || projectId || process.env.FIREBASE_AUTH_EMULATOR_HOST);
var app = (0, app_1.getApps)().length > 0 ? (0, app_1.getApp)() : (0, app_1.initializeApp)(__assign({ projectId: projectId, storageBucket: storageBucket }, (credential ? { credential: credential } : {})));
// 1. Initialize App
var db = (0, firestore_1.getFirestore)(app);
exports.db = db;
var storage = (0, storage_1.getStorage)(app);
exports.storage = storage;
var auth = (0, auth_1.getAuth)(app);
exports.auth = auth;
// Force the Environment Variable BEFORE initialization (Restored support for NEXT_PUBLIC_USE_FIREBASE_EMULATOR)
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST)
        process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    if (!process.env.FIRESTORE_EMULATOR_HOST)
        process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST)
        process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
    console.log("🔥 Admin SDK switching to Emulator mode via Env Vars");
}
