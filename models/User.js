const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 64,
    match: /^[a-zA-Z0-9_.-]+$/,
  },
  password_hash: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['admin', 'operator'],
    default: 'operator',
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  last_login: {
    type: Date,
  },
});

/**
 * Hash password before saving if it was modified.
 */
userSchema.pre('save', async function preSave() {
  if (!this.isModified('password_hash')) return;
  this.password_hash = await bcrypt.hash(this.password_hash, SALT_ROUNDS);
});

/**
 * Compare a candidate plaintext password against the stored hash.
 * @param {string} candidatePassword
 * @returns {Promise<boolean>}
 */
userSchema.methods.comparePassword = async function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password_hash);
};

/**
 * Convenience: create a user with a plaintext password (will be hashed by pre-save).
 */
userSchema.statics.createUser = async function createUser({ username, password, role = 'operator' }) {
  return this.create({ username, password_hash: password, role });
};

module.exports = mongoose.model('User', userSchema);
