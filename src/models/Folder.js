/**
 * Folder Model
 * Virtual folder structure for organizing files
 */
import mongoose from 'mongoose';

const folderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 255,
    },
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Folder',
        default: null,
        index: true,
    },
    // Full path for efficient queries (e.g., "/Documents/Projects")
    path: {
        type: String,
        default: '/',
        index: true,
    },
    // Depth level (0 = root level)
    depth: {
        type: Number,
        default: 0,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: true,
});

// Compound indexes for efficient queries
folderSchema.index({ userId: 1, parentId: 1 });
folderSchema.index({ userId: 1, path: 1 }, { unique: true });

// Virtual for child folders
folderSchema.virtual('children', {
    ref: 'Folder',
    localField: '_id',
    foreignField: 'parentId',
});

// Pre-save: update path
folderSchema.pre('save', async function (next) {
    if (this.isModified('name') || this.isModified('parentId')) {
        if (this.parentId) {
            const parent = await this.constructor.findById(this.parentId);
            if (parent) {
                this.path = `${parent.path}/${this.name}`;
                this.depth = parent.depth + 1;
            }
        } else {
            this.path = `/${this.name}`;
            this.depth = 0;
        }
    }
    next();
});

// Get all ancestors (for breadcrumb)
folderSchema.methods.getAncestors = async function () {
    const ancestors = [];
    let current = this;

    while (current.parentId) {
        current = await this.constructor.findById(current.parentId);
        if (current) {
            ancestors.unshift(current);
        } else {
            break;
        }
    }

    return ancestors;
};

// Get immediate children
folderSchema.methods.getChildren = async function () {
    return this.constructor.find({ parentId: this._id });
};

// Check if moving to target would create circular reference
folderSchema.methods.wouldCreateCircle = async function (targetParentId) {
    if (!targetParentId) return false;
    if (targetParentId.toString() === this._id.toString()) return true;

    let parent = await this.constructor.findById(targetParentId);
    while (parent) {
        if (parent._id.toString() === this._id.toString()) return true;
        if (!parent.parentId) break;
        parent = await this.constructor.findById(parent.parentId);
    }

    return false;
};

// Update all descendant paths when folder is moved/renamed
folderSchema.methods.updateDescendantPaths = async function (oldPath) {
    const descendants = await this.constructor.find({
        userId: this.userId,
        path: { $regex: `^${oldPath}/` }
    });

    for (const desc of descendants) {
        desc.path = desc.path.replace(oldPath, this.path);
        desc.depth = desc.path.split('/').length - 1;
        await desc.save();
    }
};

// Transform to JSON
folderSchema.methods.toJSON = function () {
    return {
        id: this._id,
        name: this.name,
        parentId: this.parentId,
        path: this.path,
        depth: this.depth,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
    };
};

const Folder = mongoose.model('Folder', folderSchema);

export default Folder;
