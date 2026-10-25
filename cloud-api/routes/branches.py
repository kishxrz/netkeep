from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
from database import get_cloud_db
import models, schemas

router = APIRouter(prefix="/branches", tags=["Branches"])

@router.get("", response_model=List[schemas.BranchResponse])
def list_branches(db: Session = Depends(get_cloud_db)):
    return db.query(models.Branch).order_by(models.Branch.name).all()

@router.post("", response_model=schemas.BranchResponse)
def register_branch(branch_in: schemas.BranchCreate, db: Session = Depends(get_cloud_db)):
    existing = db.query(models.Branch).filter(models.Branch.branch_code == branch_in.branch_code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Branch code already registered")
    branch = models.Branch(**branch_in.model_dump())
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch

@router.post("/{branch_code}/ping")
def branch_ping(branch_code: str, db: Session = Depends(get_cloud_db)):
    branch = db.query(models.Branch).filter(models.Branch.branch_code == branch_code).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    branch.last_ping = datetime.utcnow()
    branch.status = "ACTIVE"
    db.commit()
    return {"branch_code": branch_code, "status": "PONG", "time": branch.last_ping.isoformat()}
